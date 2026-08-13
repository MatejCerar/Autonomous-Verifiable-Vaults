# Status

As of 2026-08-13. Built by an architect coordinating worker agents in three waves.

## What is done and verified

### research/ (REAL, live)
- All 3 Mystic Core vault addresses verified live on Flare mainnet; `asset()` matches
  the expected token for each; TVL/share-price/utilization read on-chain.
- Correction vs old notes: these are Morpho Vault V2 (adapter-based) vaults, not
  MetaMorpho V1. App is app.mysticfinance.xyz. USDT0 token re-checksummed.
- APY cross-checked on-chain vs DefiLlama to ~0.1pp. FTSO FLR/USD and XRP/USD read live.
- Labeled ESTIMATE: annualized volatilities, correlation matrix, USDT0 $1 peg.

### optimizer/ (REAL, deterministic)
- Equation derived in EQUATION.md (diminishing yield curves + risk penalty,
  KKT water-filling under caps).
- optimize.ts and optimize.py produce bit-identical output; cross-checked against a
  brute-force grid to 1e-9. Constraints asserted in output (sum=1, caps, reserve floor).
- result.json computed over the live market-data.json.
- Note: numpy could not load in the sandbox (libstdc++), so the Python path uses a
  pure-Python fallback; results are identical to the TS path.

### contracts/ (REAL, fork-tested)
- Enforcement layer unchanged from the AVV demo. Added MysticVenueAdapter (ERC-4626),
  IERC4626, MysticAddresses, DeployMystic script, MysticVenueFork test.
- `forge build` passes. Unit tests 15/15. Fork tests 6/6 against live Flare mainnet.
- Live fork execution: FXRP and WFLR full real deposit + round-trip through the live
  Core vaults; USDT0 read-only verified (no idle underlying to source in-sandbox and
  USDT0 is a checkpointed OFT that vm.deal cannot forge). Documented in the test.

### tee-model/ (REAL signature, simulated attestation)
- model.ts calls the real optimizer over the authenticated snapshot + live FTSO.
- Builds the USD-1e18 bounded Plan; signs per the frozen preimage.
- sample-envelope.json and sample-envelope-bad.json produced. Signature round-trips
  (recovered signer == model address); planHash reconstructed byte-for-byte by an
  independent verifier; totals invariant holds. Signer key = throwaway Anvil #0.

### prepared-txs/ (REAL calldata, unsigned)
- bundle.json: 6 unsigned Flare-mainnet txs (approve + ERC-4626 deposit per venue).
- Every calldata blob decoded back and asserted to match intent (incl. 18-dec WFLR).
- build.mjs regenerates deterministically from result.json + market-data.json.
- Deployed USD sum == C*(1 - reserve), drift 0. Nothing signed or broadcast.

### frontend/ (REAL, builds clean)
- Six-step walkthrough re-skinned from the AVV frontend to the Mystic allocation
  story. `sync-data.mjs` copies the 5 JSON artifacts into `public/data/`; the app
  fetches them at runtime (zod-validated). Hand-rolled SVG bars, no heavy deps.
- Step 4 mandate logic evaluated against real data: good plan passes all caps; bad
  plan trips "venue cap #0" (FXRP 40% > 30%). Step 5 shows the 6 unsigned txs with a
  disabled "Sign and send" and the not-broadcast banner.
- `tsc --noEmit` clean; `npm run build` passes (reproduced by architect, exit 0,
  dist/data/ populated). Wallet/RPC execution path removed since we never broadcast.

### architect
- ARCHITECTURE.md (the map), README.md, this STATUS.md, addresses.json.
- Cross-worker consistency verified: venueId order 0/1/2 = FXRP/USDT0/WFLR everywhere;
  USD plan (84750 / 300000 / 31759 / reserve 583491 = 1,000,000) matches optimizer
  weights and prepared-tx token amounts; totals invariant holds end to end.

## Not done (by design or environment)

- No mainnet deploy, no broadcast (Mystic is mainnet-only; the whole point is to
  prepare, not execute).
- Hardware attestation is simulated (same as the AVV demo).
- DEX swap calldata for stable -> FXRP/WFLR is flagged as a prerequisite, not fabricated.
- Full live end-to-end (frontend dev server + live FTSO) not run headlessly because
  the sandbox kills long-lived servers; verified via build + fork + one-shot runs.
