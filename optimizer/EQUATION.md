# AVV allocation: the optimizer equation

This document derives the allocation math used by the Automated Verifiable Vault
(AVV) quant core. The optimizer decides how a stablecoin-denominated vault of
capital C is spread across three Mystic / Morpho supply markets (FXRP, USDT0,
WFLR) plus a defensive reserve, to maximize risk-adjusted yield under hard caps.
The result is later serialized into a signed Plan (see `../schema/preimage.md`),
signed by the TEE, and enforced on-chain against the same caps.

No emojis, no em dashes anywhere in this file (house style).

--------------------------------------------------------------------------------

## 1. Variables and notation

Let the funded venues be indexed i = 1..n (here n = 3: FXRP, USDT0, WFLR).

- C            vault capital to allocate, in USD notional (stablecoin units).
- w_i          weight of venue i, the fraction of C supplied to venue i.
- w_r          reserve weight, the fraction parked in the defensive reserve.
- d_i = w_i * C   USD deposited into venue i.
- p_i          USD price of the venue asset (used to convert USD to token units).
- sigma_i      annualized volatility of asset i (fractional, e.g. 0.60 = 60%).
- rho_ij       correlation between assets i and j.
- Sigma        covariance matrix, Sigma_ij = rho_ij * sigma_i * sigma_j.
- lambda       risk-aversion coefficient (>= 0). Higher lambda -> more caution.
- cap_i        per-venue weight cap (default 0.30).
- maxTotalOut  cap on total deployed weight, sum_i w_i (default 0.80).
- reserveFloor minimum reserve weight w_r (default 0.20).
- L_i          available USD liquidity (market depth) at venue i.

Budget identity: sum_i w_i + w_r = 1, with all weights >= 0.

--------------------------------------------------------------------------------

## 2. The supply-yield curve (why marginal yield diminishes)

A Morpho-style isolated market has total borrow assets B_i and total supply
assets S_i. Utilization is

    u_i = B_i / S_i.

When the vault supplies an extra deposit d_i, it increases the supply side of the
denominator without changing borrows, so utilization falls:

    u_i(d_i) = B_i / (S_i + d_i).                                      (1)

The borrow rate is an AdaptiveCurveIrm-style function of utilization. Around a
target utilization u* (about 0.90 on Morpho) the curve is gentle; above u* it
rises steeply (the "kink"). A faithful and monotone-increasing approximation:

    borrowRate(u) = rBase * ( 1 + k_lo * (u / u*)            )   for u <= u*
    borrowRate(u) = rBase * ( 1 + k_lo + k_hi * ((u - u*)/(1 - u*)) )  for u > u*   (2)

with k_hi >> k_lo so the slope jumps past the kink. rBase is the rate at u = 0.
This piecewise-linear form is what `optimize.ts` and `optimize.py` implement; it
captures the essential convex-above-kink shape without needing the exact on-chain
exponential adaptive term (which drifts over time and is not needed for a static
allocation snapshot).

The supplier earns the borrow interest scaled by utilization, net of the market
fee fee_i (the share skimmed to the protocol / curator):

    r_i(d_i) = borrowRate( u_i(d_i) ) * u_i(d_i) * (1 - fee_i).        (3)

Because u_i(d_i) is strictly decreasing in d_i (eq. 1), and borrowRate is
increasing in u, the product borrowRate(u)*u is increasing in u, hence r_i is
strictly decreasing in d_i. That is the diminishing-marginal-yield property: the
more you supply, the lower the rate you earn on the whole position. This is the
single most important realism in the model. A naive optimizer that treats APY as
a constant would pile everything into the top venue up to its cap; the curve
makes the optimizer spread deposits until marginal yields equalize.

### Average vs post-deposit rate (our choice)

When you deposit d_i, every unit you add earns the post-deposit rate r_i(d_i),
because the pool rate is a single global rate applied to all suppliers pro rata.
So the correct realized yield on the deposit is the POST-DEPOSIT rate, not the
integral of the marginal curve. We therefore use

    yield contribution of venue i = d_i * r_i(d_i) = w_i * C * r_i(w_i * C).  (4)

(If instead you asked "what did the marginal dollar earn", that is the derivative
d/dd_i [ d_i * r_i(d_i) ]; we use that marginal quantity only inside the KKT
water-filling conditions in section 4, not for reporting realized APY.)

Portfolio expected return as an APY on the deployed-plus-reserve base C:

    R(w) = sum_i w_i * r_i(w_i * C).                                   (5)

The reserve earns r_r (default 0; a defensive cash sink). If the reserve earns a
money-market rate you can set r_r > 0 and add w_r * r_r to R(w); the code exposes
`reserveApy` for this and defaults it to 0.

--------------------------------------------------------------------------------

## 3. The objective and constraints

We maximize expected return minus a variance penalty (mean-variance / Markowitz
with a diminishing-return mean term):

    maximize_w    J(w) = R(w) - (lambda/2) * w^T Sigma w              (6)

subject to

    (C1) sum_i w_i + w_r = 1                         budget
    (C2) 0 <= w_i <= cap_i                           per-venue box
    (C3) sum_i w_i <= maxTotalOut                    total deployment cap
    (C4) w_r >= reserveFloor                         reserve floor
    (C5) w_i * C <= L_i                              market-depth / liquidity

Note (C1) + (C4) imply sum_i w_i <= 1 - reserveFloor. With the defaults
reserveFloor = 0.20 this is 0.80, exactly maxTotalOut, so (C3) and (C4) coincide
at the default. They are kept separate because an operator may tighten either.

The variance term uses the full covariance Sigma over the volatile legs. USDT0 is
a stablecoin with sigma approx 0, but we DO NOT set it to exactly zero: we add a
small depeg-tail volatility sigma_depeg (default 0.02) so the optimizer prices the
non-zero probability of a stablecoin depeg. This keeps Sigma positive definite and
avoids a degenerate "infinite USDT0" solution.

--------------------------------------------------------------------------------

## 4. KKT conditions and the water-filling result

### 4.1 Lagrangian

Introduce multipliers: mu (equality C1), for each i alpha_i >= 0 (upper box
w_i <= cap_i), beta_i >= 0 (lower box w_i >= 0), gamma >= 0 (total cap C3),
delta >= 0 (reserve floor C4), eta_i >= 0 (liquidity C5). Fold the liquidity cap
into an effective upper bound cap_i' = min(cap_i, L_i / C); then C5 is just a
tighter box and we can drop eta_i, using cap_i' in place of cap_i.

Define the MARGINAL yield of venue i (derivative of its yield contribution wrt its
own weight), which is what competes for capital:

    m_i(w_i) = d/dw_i [ w_i * C * r_i(w_i * C) ]
             = C * [ r_i(d_i) + d_i * r_i'(d_i) ],   d_i = w_i * C.     (7)

Because r_i is decreasing, m_i(w_i) is decreasing in w_i (diminishing returns).

The Lagrangian (dropping the reserve-return term, r_r = 0, for clarity):

    L = sum_i w_i r_i(w_i C) - (lambda/2) w^T Sigma w
        - mu ( sum_i w_i + w_r - 1 )
        - sum_i alpha_i ( w_i - cap_i' ) + sum_i beta_i w_i
        - gamma ( sum_i w_i - maxTotalOut )
        + delta ( w_r - reserveFloor ).

### 4.2 Stationarity

For each venue i (partial wrt w_i):

    m_i(w_i) - lambda (Sigma w)_i - mu - alpha_i + beta_i - gamma = 0.  (8)

For the reserve (partial wrt w_r):  r_r - mu + delta = 0, i.e. mu = r_r + delta.
With r_r = 0 and delta >= 0 this gives mu = delta >= 0. So mu is the shadow price
of the budget, equal to the reserve floor multiplier.

### 4.3 Complementary slackness

    alpha_i ( w_i - cap_i' ) = 0,   beta_i w_i = 0,
    gamma ( sum_i w_i - maxTotalOut ) = 0,  delta ( w_r - reserveFloor ) = 0.

### 4.4 Water-filling interpretation

Define the RISK-ADJUSTED marginal yield of venue i:

    g_i(w) = m_i(w_i) - lambda (Sigma w)_i.                            (9)

For an INTERIOR funded venue (0 < w_i < cap_i'), both alpha_i = 0 and beta_i = 0,
so eq. 8 reads

    g_i(w) = mu + gamma  = the SAME constant for every interior venue.  (10)

This is the water-filling / equal-marginal-yield law: at the optimum, every venue
that is funded but not clamped earns the same risk-adjusted marginal yield. Call
that common level the "water line" nu = mu + gamma.

The clamps read off directly from the sign of the slack multipliers:

- If g_i(w) would exceed nu even at w_i = cap_i', then alpha_i > 0 and the venue
  is CLAMPED AT ITS CAP (cap_i, liquidity, or the effective min of the two).
  Binding constraint: "venue cap" or "liquidity".
- If g_i(w) < nu even at w_i = 0+, then beta_i > 0 and the venue is UNFUNDED
  (w_i = 0). It is too low-yield or too risky to enter. Binding constraint:
  "excluded (below water line)".
- Otherwise the venue is interior and sits exactly on the water line.

The water line nu itself is pinned by the budget: raise nu until the total funded
weight equals the active budget min(maxTotalOut, 1 - reserveFloor). If the sum of
caps is below that budget, all venues clamp and the leftover goes to reserve
(reserve exceeds its floor); gamma = 0 in that case.

### 4.5 Closed-form intuition (Markowitz tangency, then clip)

Linearize the mean term around a base rate: near the operating point write
m_i approx a_i - c_i w_i with a_i = m_i(0) (the marginal yield of the first
dollar) and c_i = -m_i'(0) > 0 (the curvature, how fast marginal yield decays).
Then stationarity eq. 8 for interior venues becomes a linear system

    a_i - c_i w_i - lambda (Sigma w)_i = nu   for all funded i,

i.e.  ( lambda Sigma + diag(c) ) w = a - nu 1.  So

    w*(nu) = ( lambda Sigma + diag(c) )^{-1} ( a - nu 1 ).             (11)

This is exactly the Markowitz tangency form w* proportional to (Sigma-like)^{-1}
times (excess-return vector), where the diagonal diag(c) is the extra curvature
that the diminishing-yield curve adds to the risk matrix. The recipe is:

  1. Compute the unconstrained tangency direction from eq. 11 at nu = 0.
  2. Clip each w_i into its box [0, cap_i'].
  3. Choose nu (equivalently rescale) so sum_i w_i hits the total-out budget.
  4. Re-check the box after rescaling; iterate (active-set) until stable.

This closed form is the intuition and a good warm start. Because the true mean
term is piecewise-linear (the IRM kink) rather than globally linear, the shipped
solver does not trust the closed form blindly; it uses a robust numeric method
that handles the kink and the box exactly. See section 5.

--------------------------------------------------------------------------------

## 5. The numeric solver (what the code actually runs)

With only n = 3 assets, the constrained problem is tiny and we solve it exactly
and verifiably by PROJECTED GRADIENT ASCENT with an exact projection onto the
feasible set:

    Feasible set F = { w : 0 <= w_i <= cap_i',  sum_i w_i <= T },
    where T = min(maxTotalOut, 1 - reserveFloor) is the active deployment budget.

Algorithm (deterministic, no randomness):

  1. Precompute cap_i' = min(cap_i, L_i / C).
  2. Start at w = 0 (all reserve). J is concave in w on F (the mean term is
     concave because each m_i is decreasing, and -(lambda/2) w^T Sigma w is
     concave for PSD Sigma), so gradient ascent converges to the global optimum.
  3. Repeat for a fixed number of iterations (default 2000):
       grad_i = g_i(w) = m_i(w_i) - lambda (Sigma w)_i          (eq. 9)
       w <- project_onto_F( w + step * grad )
     using a decaying step. The projection onto the capped simplex-with-slack F
     is done in closed form: clip to the box, and if sum_i w_i > T, subtract a
     common water-level tau from every unclamped coordinate (a 1-D bisection on
     tau, a few iterations) until the sum equals T. This projection is exactly the
     water-filling of section 4.4, so the solver and the KKT theory agree by
     construction.
  4. reserve = 1 - sum_i w_i, guaranteed >= reserveFloor because sum_i w_i <= T
     <= 1 - reserveFloor.

Because the problem is 3-dimensional and concave, this converges to the unique
global optimum. As an independent cross-check the code can also brute-force over
the 2^3 active-sets (each venue: unfunded / interior / clamped) and solve the
resulting small linear system, but the projected-gradient result is what ships and
the two agree to 1e-6 on the sample.

Determinism note: fixed iteration count, fixed step schedule, no RNG, IEEE-754
double throughout. The TS and Python implementations run the identical recurrence
so they produce bitwise-comparable weights (documented to 1e-9 in the README).

--------------------------------------------------------------------------------

## 6. Worked example (the SAMPLE numbers)

Capital C = 1,000,000 USD. Defaults: cap_i = 0.30, maxTotalOut = 0.80,
reserveFloor = 0.20, lambda = 0.10, reserveApy = 0.

### Units and lambda calibration (important)

Both terms of J(w) are kept dimensionless, in fraction-of-C units. The mean term
w_i * r_i is a fraction of C (an APY). The variance term (lambda/2) w^T Sigma w
uses Sigma built from annualized fractional vols, so it is also dimensionless.
Realized USD yield is simply the APY times C; the optimizer never mixes USD and
fractions inside the objective (an earlier draft did and produced nonsense, fixed).

lambda is calibrated to the fact that the volatile legs here have large annualized
vols (0.55 to 0.70). Their squared vols (0.30 to 0.49) are an order of magnitude
larger than the marginal APYs (0.05 to 0.06), so a raw mean-variance lambda of a
few units would push almost everything to reserve. We default lambda = 0.10, which
keeps the vault deploying its full budget while still discounting the volatile
legs. Two calibration caveats an operator should know:

  1. A SUPPLY position returns the same token plus interest; the depositor's
     principal is not marked-to-market against the asset's spot path the way a spot
     holder's is. The USD vol matters for the stablecoin-denominated NAV and for
     smart-contract / liquidation / bad-debt tail risk, not for a price round-trip.
     So the "variance of the volatile legs" here is a PROXY for supply-side tail
     and NAV risk, deliberately conservative. Lower lambda if you judge supply
     positions less exposed; raise it to stress the tail.
  2. The lambda sweep below is monotone and interpretable, so the operator can dial
     risk appetite directly. lambda = 0.10 reproduces the clamped-plus-interior
     story in this section.

Per-venue market snapshot (this is the labeled SAMPLE in the code, not live data;
B_i and S_i are in USD, derived from utilization and totals):

| venue | B_i (borrow) | S_i (supply) | u_i0  | fee   | sigma |
|-------|--------------|--------------|-------|-------|-------|
| FXRP  | 3.2M         | 4.0M         | 0.800 | 0.10  | 0.55  |
| USDT0 | 7.2M         | 8.0M         | 0.900 | 0.10  | 0.02  |
| WFLR  | 1.8M         | 3.0M         | 0.600 | 0.10  | 0.70  |

The SAMPLE has no reported supplyApy, so the model uses the fallback rateAtTarget
(0.05) with the u* = 0.90, s = 4 curve of eq. 2. USDT0 sits AT the kink so it has
the highest supply rate; FXRP is just below; WFLR is under-utilized and yields
least. When a real supplyApy IS present (as in the live data below), rateAtTarget
is instead CALIBRATED per venue so the model reproduces the reported APY at the
reported utilization, anchoring the curve to live data.

Correlation matrix (FXRP, USDT0, WFLR):

    rho = [ 1.00  0.10  0.45 ]
          [ 0.10  1.00  0.05 ]
          [ 0.45  0.05  1.00 ]

USDT0 vol is floored at sigma_depeg = 0.02 to price its depeg tail.

Running the shipped solver at lambda = 0.10 on the SAMPLE (verified against a fine
grid to 1e-9; see `result.json` when run on SAMPLE) gives:

- FXRP  weight 0.300  (CLAMPED at venue cap)
- USDT0 weight 0.300  (CLAMPED at venue cap; the near-zero-vol high-yield anchor)
- WFLR  weight 0.200  (INTERIOR; funded up to the water line, high vol 0.70 keeps
        it below its 0.30 cap)
- reserve 0.200       (exactly the floor; total deployed = 0.80 = maxTotalOut)

Expected APY R(w) approx 2.38%, risk-adjusted approx 2.04%. The qualitative story:
the two high-rate venues fill to their caps, the volatile WFLR takes the residual
up to the water line, and the reserve stays at its 20% floor. A naive equal split
would over-fund WFLR relative to its risk; ignoring the yield curve you would try
to dump everything into the top venue and be clamped with idle capital.

### Live-data result (research/market-data.json, Flare mainnet, chainId 14)

Running on the REAL research snapshot (Mystic Core vaults over Morpho Blue) gives
a very different, and instructive, allocation (rateAtTarget calibrated per venue to
the reported supplyApy):

| venue | obs supplyApy | util  | sigma | liq (USD) | weight  | binding      |
|-------|---------------|-------|-------|-----------|---------|--------------|
| FXRP  | 0.37%         | 0.830 | 0.55  | 1.2M      | 0.0848  | interior     |
| USDT0 | 3.28%         | 0.849 | 0.01  | 3.19M     | 0.3000  | venue cap    |
| WFLR  | 4.59%         | 0.943 | 0.80  | 31.8k     | 0.0318  | liquidity    |

reserve 0.5835, expectedApy 1.05%, riskAdjApy 1.03%. Reading it:

- USDT0 is the anchor: highest safe yield (3.28%, near-zero vol), so it pins at its
  30% cap.
- WFLR has the highest headline APY (4.59%) but the market runs hot (94% util) and
  only about 31.8k USD is instantly withdrawable, so the LIQUIDITY cap binds hard:
  the optimizer can only place 3.18% there even though the yield is attractive.
  This is the depth constraint (C5) doing exactly its job.
- FXRP yields almost nothing right now (0.37%), so its risk-adjusted marginal yield
  reaches the water line (near 0) after only 8.5%; beyond that, deploying more FXRP
  is worse than holding reserve.
- Reserve ends at 58%, well above its 20% floor, because there is simply not enough
  profitable, liquid, risk-adjusted yield to justify deploying the full 80% budget.
  That is the honest answer for this snapshot, and it is the kind of defensive call
  the AVV is designed to make and have enforced on-chain.

### lambda sweep (verified, monotone) on the SAMPLE

| lambda | FXRP  | USDT0 | WFLR  | reserve | APY    | riskAdjAPY |
|--------|-------|-------|-------|---------|--------|------------|
| 0.00   | 0.300 | 0.300 | 0.200 | 0.200   | 2.38%  | 2.38%      |
| 0.10   | 0.300 | 0.300 | 0.200 | 0.200   | 2.38%  | 2.04%      |
| 0.50   | 0.176 | 0.300 | 0.018 | 0.505   | 1.72%  | 1.44%      |
| 1.00   | 0.096 | 0.300 | 0.007 | 0.598   | 1.46%  | 1.30%      |
| 2.00   | 0.050 | 0.300 | 0.003 | 0.648   | 1.31%  | 1.22%      |
| 8.00   | 0.012 | 0.300 | 0.000 | 0.687   | 1.18%  | 1.14%      |

As lambda rises the volatile legs (WFLR first, then FXRP) shed weight, the
near-zero-vol USDT0 stays pinned at its cap, and reserve grows past its floor. This
is exactly the section 7 sensitivity story, produced by the shipped solver. The
exact numbers are reproducible with `optimize.py` / `optimize.ts` and may drift as
the live snapshot changes.

--------------------------------------------------------------------------------

## 7. Sensitivity discussion

How the optimum moves as inputs change:

- lambda up (more risk-averse): the variance penalty grows, so the high-vol legs
  (WFLR sigma 0.70, FXRP sigma 0.55) shed weight first. WFLR leaves the water line
  and shrinks toward 0; capital rotates into low-vol USDT0 and into reserve. In
  the limit lambda -> infinity only the minimum-variance mix survives (dominated
  by USDT0) and the rest goes to reserve. lambda down (yield-hungry): weights push
  toward the pure-yield ranking and more venues clamp at their caps.

- cap_i up (looser per-venue cap): a venue that was clamped (FXRP, USDT0 in the
  sample) can absorb more, so its weight rises until either it hits the water line
  or the total-out budget binds. Raising all caps above the point where the sum of
  caps exceeds maxTotalOut makes the TOTAL cap (C3) the binding constraint instead
  of the per-venue caps, and the interior water-filling among venues resumes.

- reserveFloor up: the deployment budget T = 1 - reserveFloor shrinks, the water
  line rises, and the lowest risk-adjusted-marginal venue (WFLR first) is cut back.
  Everything scales down proportionally among interior venues; clamped venues stay
  clamped until the budget falls below the sum of their caps.

- an APY change (say FXRP borrow demand spikes, u_FXRP0 -> 0.95, above the kink):
  FXRP marginal yield jumps, its risk-adjusted marginal g_FXRP rises well above the
  water line, so FXRP stays pinned at its cap and the water line for the remaining
  venues adjusts. If instead an APY collapses (a venue's borrows drain), that venue
  drops off the water line and can go to zero, and its freed budget is re-filled by
  the next-best venue or the reserve.

- correlation up (rho_FXRP,WFLR up): the two correlated volatile legs become a
  worse diversifier together, so their combined variance contribution rises; the
  optimizer trims the one with the weaker standalone risk-adjusted yield (WFLR) and
  leans harder on the uncorrelated USDT0.

- liquidity L_i down (thin market): cap_i' = min(cap_i, L_i / C) tightens, so a
  venue may clamp at a liquidity-driven bound below its nominal cap. The reported
  bindingConstraint switches from "venue cap" to "liquidity", and the freed budget
  spills to the next venue or reserve.

All of these are monotone, interpretable moves, which is what you want from a
model whose output is signed and enforced on-chain: an operator can predict how a
parameter tweak will move the allocation before it is ever signed.
