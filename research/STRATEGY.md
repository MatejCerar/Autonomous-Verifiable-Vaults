# Mystic (Flare) Allocation Strategy — Reasoning for the Optimizer

Scope: supply-side allocation across the 3 Mystic Core vaults (FXRP, USDT0, WFLR) under caps,
maximizing risk-adjusted yield. This document gives the *reasoning and constraints*; it guides,
does not hardcode, the optimizer. All numbers as of 2026-08-13; see `market-data.json`.

## 1. Snapshot the optimizer starts from

| Asset | Supply APY | Utilization | TVL | Instant liquidity | Ann. vol (est) | Price risk driver |
|-------|-----------:|------------:|----:|------------------:|---------------:|-------------------|
| USDT0 | 3.28% | 84.9% | $21.1M | ~$3.2M | ~1% | stable |
| WFLR  | 4.59% | 94.3% | $0.56M | ~$0.03M | ~80% | FLR (at ATL) |
| FXRP  | 0.37% | 83.0% | $2.2M | ~$1.2M | ~55% | XRP |

## 2. How supply APY moves with deposit size (diminishing returns)

Supply APY ≈ borrowAPY × utilization, and borrowAPY is set by AdaptiveCurveIrm around a 90%
utilization kink. When you deposit `d` into a market with supply `S` and borrow `B` held fixed:

- New utilization = `B/(S+d)` (falls). Borrow rate falls with it (below the kink, ~linearly; above
  the kink, steeply). Supply APY falls on **both** counts (lower rate AND you now share the same
  borrower interest across a larger base).
- **Rule of thumb:** `supplyAPY_after ≈ supplyAPY_now × (S/(S+d))` as a first-order approximation
  while below the kink, and *faster* than that if the market was above 90% (you drop off the steep
  part of the curve).

Concretely per asset:
- **WFLR is the trap.** It looks like the top APY (4.59%) but it is only 4.59% *because* it is jammed
  at 94% utilization (dominant market 92%, others 98-99%). It sits on the steep side of the kink.
  Deposit meaningfully and you slide down the steep curve fast: e.g. pushing the dominant WFLR market
  from 92% to 85% util roughly halves its marginal contribution. Its TVL is tiny ($0.56M) and
  instant liquidity is ~$32k, so even a modest allocation (a few $100k) materially compresses the
  rate and cannot be pulled back out quickly. **WFLR APY is high-but-shallow.**
- **USDT0 is the deep pool.** $21M TVL, 85% util, sitting *just below* the kink — the gentle part of
  the curve. You can add size here with the least APY give-up per dollar, and it has $3.2M instant
  liquidity. Marginal APY erodes slowly. **USDT0 APY is medium-but-deep.**
- **FXRP is quiet and cheap.** 0.37% is genuinely low: its dominant market is at 88% util but the
  underlying borrow rate is tiny (rateAtTarget is ~5x lower than USDT0's), i.e. little borrower
  demand for FXRP. Adding supply only dilutes an already-thin yield. **FXRP APY is low-and-thin.**

## 3. Risk-adjusted ranking (why USDT0 wins the core, WFLR is a satellite)

Rough risk-adjusted yield (APY / vol) as a sharpe-like screen — *illustrative, uses estimated vol*:
- USDT0: 3.28% / ~1% depeg-vol → very high per unit of price risk (yield is the dominant risk term).
- WFLR: 4.59% / ~80% → tiny; the FLR price risk (and FLR at all-time-low) dwarfs the extra ~1.3pp of
  yield over USDT0.
- FXRP: 0.37% / ~55% → worst; low yield AND meaningful XRP price risk.

**But note the risk framing matters.** If the optimizer measures risk *in each asset's own units*
(you hold FXRP and want FXRP yield, you hold FLR and want FLR yield), then price vol is not the risk —
the risks are (a) yield variance, (b) smart-contract/curator risk, (c) liquidation/bad-debt risk in
the underlying markets, and (d) withdrawal/liquidity risk. In that framing:
- USDT0 still wins the **core** allocation: highest deep-yield, best liquidity, stable collateral.
- WFLR is a **yield satellite**: take some, but capped by its shallow curve and terrible liquidity.
- FXRP is a **hold-not-chase**: if you already hold FXRP, supplying earns a token yield with low
  liquidity risk (big $1.2M buffer), but do not over-weight it for yield's sake.

## 4. Reserve buffer — why it matters here

- **WFLR instant liquidity is ~$32k against $0.56M TVL.** Any optimizer that treats WFLR TVL as
  freely withdrawable is wrong. Model WFLR withdrawal capacity = market idle (≈ (1−util)×supply),
  which is tiny and volatile. Keep WFLR exposure small enough that you never need to exit fast.
- Morpho Vault V2 supports `forceDeallocate` (pull from a market past its idle) but it charges a
  **forceDeallocatePenalty** — treat forced exits as costly, not free.
- Hold a stablecoin (USDT0) reserve as the liquidity backstop: it is the only vault with both size and
  real instant liquidity ($3.2M). A reserve buffer lets the portfolio meet redemptions and
  opportunistically add when a borrow spike lifts an APY (USDT0 hit 4.8% on 08-11).

## 5. Liquidity / withdrawal constraints (hard inputs for the optimizer)

| Asset | TVL | Instant withdrawable | Constraint to encode |
|-------|----:|---------------------:|----------------------|
| USDT0 | $21.1M | ~$3.2M (15% of TVL) | soft cap; can add size, exits fine |
| FXRP  | $2.2M | ~$1.2M (incl. vault idle buffer) | can exit ~half instantly |
| WFLR  | $0.56M | ~$0.03M (5.7% of TVL) | **hard**: do not allocate more than you can afford to lock |

Suggested allocation-cap guidance (qualitative): cap WFLR at a small slice (its liquidity + shallow
curve both argue for it); let USDT0 be the anchor; size FXRP to whatever FXRP you actually hold rather
than chasing its yield.

## 6. Depeg / liquidation / bad-debt risk per asset

- **USDT0** (loan asset): depeg risk of LayerZero-bridged USDT (bridge + issuer risk). Underlying
  collateral in its dominant market is **FXRP at 77% LLTV** — so USDT0 suppliers are indirectly
  exposed to a sharp XRP drawdown causing under-collateralized FXRP borrowers. Liquidations protect
  suppliers but a gap-down + thin FXRP liquidity could leave bad debt. Still the lowest-risk of the 3.
- **WFLR** (loan asset): FLR is at an all-time low with high vol; the dominant WFLR market has an
  aggressive **86% LLTV** against a staked/rFLR-type collateral (`0x0988C6…`) — high LLTV + volatile
  collateral = tighter liquidation margin. Highest liquidation/bad-debt risk of the 3, plus the
  liquidity trap above.
- **FXRP** (loan asset): dominant market collateralized by `0x4C18Ff…` at 62.5% LLTV (conservative).
  Low borrower demand means low utilization risk. Main risks are FXRP/FAssets systemic (agent
  collateralization, XRP price) rather than market-level. Lowest *market* risk, lowest yield.

Shared risks: single curator (`0x72882e…`) across all 3 vaults (curator/allocator key risk); a young
standalone Morpho Blue deployment on Flare (less battle-tested than Ethereum mainnet Morpho); 10%
performance fee already netted out of the APYs above.

## 7. Recommended qualitative tilt (guides, not hardcodes, the optimizer)

1. **Core = USDT0.** Deepest, best liquidity, sits below the IRM kink so it de-rates slowly on inflow,
   stable collateral, best risk-adjusted yield. Make it the largest weight.
2. **Satellite = WFLR, capped small.** Real yield uplift but shallow curve + ~$32k instant liquidity.
   Cap it hard; do not let the optimizer chase the 4.59% headline into a position it cannot exit.
   If you hold FLR natively, this is a reasonable FLR-denominated yield; if not, the ~80% price vol
   likely fails a risk-adjusted screen.
3. **FXRP = hold-weight, not yield-weight.** 0.37% is too thin to chase. Allocate only FXRP you
   already hold; its large idle buffer makes it easy to exit, so it is a fine parking spot, not an
   alpha source.
4. **Keep a USDT0 reserve buffer** for redemptions and to buy transient APY spikes (borrow-demand
   pushes any market's APY up intra-week; USDT0 briefly hit 4.8%).
5. **Respect diminishing returns:** the optimizer should use per-market `supplyAPY(d) ≈
   borrowAPY(B/(S+d)) × (B/(S+d)) × 0.9` rather than a flat APY, so it stops adding to a vault once its
   marginal yield drops below the next-best vault's marginal yield. This naturally caps WFLR and steers
   size into USDT0.
