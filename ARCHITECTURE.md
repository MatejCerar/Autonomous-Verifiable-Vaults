# Architecture map

An Autonomous Verifiable Vault (AVV) demo re-pointed at **Mystic Finance on Flare
mainnet**. It is the same wrapper as the `demo/` AVV proof of concept: a curator's
allocation model runs inside a TEE, signs a bounded plan, and an on-chain
controller enforces the plan against hard caps before any funds move. What changes
here is the target: the venues are the real Mystic Core vaults (FXRP, USDT0, WFLR),
and the model's job is a genuine **multi-token allocation optimization** over live
market data.

Mystic lives only on Flare **mainnet** (chainId 14), not on Coston2. We do not
deploy the wrapper to mainnet and we do not broadcast anything. So the one thing in
this demo that is fully real and load-bearing is the **calculation**: read the live
markets, solve for the optimal position across the three tokens, and **prepare the
exact transactions** that would deploy it. Those transactions are written out,
decoded, and verified, but never signed or sent.

## What is real vs simulated

| Layer | Status |
| --- | --- |
| Live Mystic/Morpho market data (APY, utilization, liquidity, TVL, LLTV) | REAL, read on-chain from Flare mainnet + cross-checked vs DefiLlama |
| FTSO prices (FLR/USD, XRP/USD) | REAL, read from FTSO V2 |
| Allocation optimizer (equation + solver) | REAL, deterministic, grid-verified |
| TEE signing of the bounded plan (EIP-191, code fingerprint) | REAL signature; hardware attestation SIMULATED |
| On-chain cap enforcement contracts | REAL, compiled + fork-tested against live Mystic vaults |
| Prepared transactions (approve + ERC-4626 deposit per venue) | REAL calldata for chainId 14, decoded + verified |
| Broadcasting / execution | NOT done (Mystic is mainnet-only; by design) |
| Hardware root of trust (GCP Confidential Space) | SIMULATED, same as the AVV demo |

## Build model (the multi-worker map)

This demo was built by an **architect** coordinating specialized worker agents,
each owning one directory so they never collide. The architect set conventions,
launched workers in dependency waves, verified cross-worker consistency, and wrote
the integration docs.

```
                          ARCHITECT (conventions, waves, integration, verification)
                                              |
        Wave 1 (parallel) --------------------+---------------------------
          research/  (live data + strategy)   optimizer/ (equation+engine)   contracts/ (enforcement re-skin)
                                              |
        Wave 2 (parallel) --------------------+---------------------------
          tee-model/ (sign the plan)          prepared-txs/ (unsigned bundle)
                                              |
        Wave 3 --------------------------------+---------------------------
          frontend/ (6-step walkthrough)      ARCHITECT: docs + addresses + final verify
```

Canonical conventions all workers were held to:
- **venueId order: 0 = FXRP, 1 = USDT0, 2 = WFLR** (matches the contract adapter
  wiring in `contracts/script/DeployMystic.s.sol`).
- **Plan/enforcement unit = USD in 1e18 fixed point.** Capital C default =
  1,000,000 USD = `1000000e18`. This mirrors the AVV demo's 18-decimal stable so
  the enforcement layer is unchanged.
- **Mandate caps:** per-venue 30%, max-total-out 80%, reserve floor 20%.
- The prepared transactions convert the USD plan into **real per-token amounts**
  via the live price and token decimals.

## Component map + data flow

```
research/market-data.json ---> optimizer/optimize.(ts|py) ---> optimizer/result.json
       (live snapshot)              (risk-adjusted              (optimal weights,
                                     water-filling QP)           per-venue amounts)
                                          |
                     +--------------------+---------------------+
                     v                                          v
        tee-model/  (model.ts calls optimize,        prepared-txs/build.mjs
         builds USD-1e18 Plan, signs it)              (USD -> token amounts,
                     |                                 approve + deposit calldata)
                     v                                          v
        tee-model/sample-envelope.json            prepared-txs/bundle.json
         (+ sample-envelope-bad.json)              (6 unsigned Flare-mainnet txs)
                     |                                          |
                     +--------------------+---------------------+
                                          v
             contracts/  CurationController verifies signature + fingerprint,
             enforces caps, routes through MysticVenueAdapter -> real Core vaults
                                          |
                                          v
                       frontend/  six-step walkthrough of one cycle
                       (fetches all of the JSON artifacts above)
```

### research/
Live Flare-mainnet snapshot of the three Mystic Core vaults and their Morpho Blue
markets: verified addresses, supply APY, utilization, available liquidity, TVL,
LLTV, share prices, FTSO prices, and estimated volatilities/correlations for the
risk model. `market-data.json` is the machine-readable source of truth; `STRATEGY.md`
is the reasoning; `SOURCES.md` marks each number live vs API vs estimate.

### optimizer/
The intellectual core. `EQUATION.md` derives the allocation math: each market has a
diminishing supply-yield curve (adding deposit dilutes utilization through an
AdaptiveCurveIrm-style rate), and we maximize `sum_i w_i r_i(w_i C) - (lambda/2) w^T Sigma w`
under budget, per-venue cap, total-out cap, reserve floor, and liquidity
constraints. KKT gives water-filling: funded venues equalize risk-adjusted
marginal yield up to their clamps. `optimize.ts` and `optimize.py` implement the
same solver (bit-identical, grid-verified); `result.json` is the solution over the
live snapshot.

### contracts/
The unchanged AVV enforcement layer (CurationController, MandateRegistry,
AutomatedCurationVault, PlanLib, ReserveAdapter) plus a new `MysticVenueAdapter`
that deposits/withdraws into the real Core ERC-4626 vaults, and a fork test that
proves it against live Flare mainnet. Addresses in `src/MysticAddresses.sol`.

### tee-model/
The simulated enclave. `model.ts` calls the optimizer over the authenticated
market snapshot + live FTSO reads, builds the bounded USD-1e18 `Plan`, and signs
its hash per the frozen preimage (`schema/preimage.md`). Emits a good envelope and
a deliberately over-cap bad envelope for the rejection demo.

### prepared-txs/
The deliverable the user asked for: `bundle.json` is the ordered set of unsigned
Flare-mainnet transactions (per venue: ERC20 `approve` then ERC-4626 `deposit`)
that would deploy the optimizer's allocation. `build.mjs` regenerates it
deterministically from `result.json` + `market-data.json`. Nothing is signed or
broadcast; `PREPARED_TX.md` explains how to broadcast later and the swap
prerequisite (capital is a USD notional; acquiring FXRP/WFLR from a stable needs a
DEX swap first).

### frontend/
A six-step walkthrough of one cycle: (1) live market inputs + graphs, (2) the
optimizer running "inside the TEE", (3) the signed bounded plan, (4) on-chain cap
validation incl. the bad-plan rejection, (5) the prepared (not broadcast)
transactions, (6) a real-vs-simulated recap.

## Live result in this snapshot (2026-08-13)

Capital 1,000,000 USD, caps 30/80/20, lambda 0.1:

| Venue | Supply APY | Weight | USD | Binding constraint |
| --- | --- | --- | --- | --- |
| FXRP | 0.37% | 8.48% | 84,750 | interior (on the water line) |
| USDT0 | 3.28% | 30.0% | 300,000 | venue cap |
| WFLR | 4.59% | 3.18% | 31,759 | liquidity (~32k withdrawable) |
| Reserve | - | 58.35% | 583,491 | reserve (defensive) |

Portfolio expected APY 1.05%, risk-adjusted 1.03%. The high reserve is the honest
answer for this snapshot: WFLR's headline 4.59% is a shallow, jammed pool (94%
utilization, ~$32k exit liquidity), FXRP's 0.37% is too thin to chase, so only
USDT0 earns its full cap and most capital stays in reserve rather than buying
uncompensated risk. Change a knob (an APY, a cap, lambda) and the allocation moves.

## Known simplifications (kept honest)

- **Multi-asset accounting.** The vault reasons in a USD notional; the three venues
  hold different tokens. Real execution needs a stable-to-FXRP / stable-to-WFLR DEX
  swap before each deposit. The prepared bundle lists the deposits and flags the
  swap as a prerequisite step rather than fabricating router calldata.
- **Curator underneath.** Depositing into Mystic Core reintroduces Mystic's own
  curator one layer down. For a pure "no hidden curator" story the adapters would
  point at raw capped Morpho Blue markets instead. Noted, not hidden.
- **Attestation.** The hardware root of trust is simulated, exactly as in the AVV
  demo. Swapping the signer for a `tee-node` enclave makes it real with no contract
  change.
