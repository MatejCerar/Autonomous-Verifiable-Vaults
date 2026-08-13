# Sources & Provenance

Snapshot time: 2026-08-13 ~07:24 UTC. Chain: Flare mainnet (chainId 14).
Each entry: source, what was taken, and classification **[LIVE on-chain] / [API] / [ESTIMATE]**.

## On-chain reads (LIVE) — RPC https://flare-api.flare.network/ext/C/rpc (chainId 0xe confirmed)

Tool: `cast` (Foundry 1.7.1, installed via `nix profile add nixpkgs#foundry`). All 3 RPCs from the
brief (flare-api, ankr, thirdweb) returned chainId 0xe=14; used flare-api as primary. All reads
read-only; nothing broadcast.

- **[LIVE]** Vault identity for all 3 (name, symbol, decimals, asset, totalAssets, totalSupply,
  convertToAssets(1e18)). Confirmed asset() of each vault == expected token. Share prices derived.
  Vaults: `0x53184a…` (Core FXRP/CSXRP), `0xE8dd6A…` (Core USDT0/COREUSDT0), `0x1aEadA…` (Core
  wFLR/COREWFLR).
- **[LIVE]** Token identity: FXRP `0xAd552A…` (dec 6), USD₮0 `0xe7cd86…` (dec 6), WFLR `0x1D80c4…`
  (dec 18).
- **[LIVE]** Vault type discovery via Blockscout ABI API
  `https://flare-explorer.flare.network/api?module=contract&action=getabi&address=…` — revealed
  **Morpho Vault V2** interface (adapters, absoluteCap, performanceFee, liquidityAdapter, etc.),
  correcting the assumption that these are MetaMorpho V1 (V1 queue calls revert).
- **[LIVE]** performanceFee=10%, managementFee=0, adaptersLength=1, liquidityAdapter address, maxRate
  (safety cap: ~15% APR FXRP/WFLR, ~200% USDT0), curator `0x72882e…`, owner `0x309884…` for each vault.
- **[LIVE]** Adapter market wiring: `adapter.morpho()` = Morpho Blue `0xF4346F…`; `marketIdsLength()`
  = 3 each; `marketIds(0..2)` = the 9 market ids; `adapter` supplyShares position per market via
  `Morpho.position(id, adapter)`.
- **[LIVE]** Morpho Blue `market(id)` (totalSupplyAssets/Shares, totalBorrowAssets/Shares, lastUpdate,
  fee=0) and `idToMarketParams(id)` (loanToken, collateralToken, oracle, irm=AdaptiveCurveIrm, lltv)
  for all 9 markets. Utilization, borrowAPY, supplyAPY recomputed from these.
- **[LIVE]** AdaptiveCurveIrm `0xE5B562…` `rateAtTarget(id)` (per-sec WAD) for all 9 markets — input to
  the borrow-rate curve.
- **[LIVE]** FTSO V2 (resolved via ContractRegistry `0xaD67FE…` `getContractAddressByName("FtsoV2")`
  = `0x7BDE3D…`). `getFeedById`: FLR/USD = $0.0059951 (599510, dec 8), XRP/USD = $1.013054 (1013054,
  dec 6), feed ts 2026-08-13T07:19:35Z.

## DefiLlama (API)

- **[API]** `https://yields.llama.fi/pools` filtered chain="Flare", project="mystic-finance-lending":
  - COREUSDT0 pool `5ea185f4-b3cc-4fd8-afe6-39037bf483dd`: apy 3.27832%, apyBase 3.27832%, apyReward
    null, tvlUsd 21,074,299, apyMean30d 8.44622%, apyPct30D −9.28.
  - CSXRP pool `ae77c3b6-f9ca-49a8-b24d-08c12ac2d7b4`: apy 0.36551%, tvlUsd 2,201,182 (was ~2.9M),
    apyMean30d 1.04854%.
  - COREWFLR pool `cd22e73a-e73d-48b1-a919-2522b109119a`: apy 4.58941%, tvlUsd 560,794, apyMean30d
    6.15285%.
  - Fetched at ~07:20 UTC. Used for: headline supplyApy, apyBase, apyReward, tvlUsd.
- **[API]** `https://yields.llama.fi/chart/<poolId>` for all 3 — 8-day APY & TVL history (the
  "graphs"), reproduced in MARKET_DATA.md.
- **[API]** `https://api.llama.fi/protocol/mystic-finance-lending` — shows Mystic also deployed on
  Plume; the Flare pool-level data above is the relevant source for this task.

## Web (context + cross-checks)

- **[API/context]** WebSearch "Mystic Finance Flare Morpho lending…": confirmed Mystic = curated
  vaults over Morpho on Flare, curators incl. Clearstar, launched Feb 2026 for FXRP/FLR/USDT0.
  (flare.network/news, crypto.news, coindesk, genfinity, support.bifrostwallet.com.)
- **[context]** Bifrost support article (support.bifrostwallet.com/en/articles/13714409) — confirmed
  the **real app URL is `app.mysticfinance.xyz`** and the deposit/withdraw UX. No numeric APY/LLTV in
  the article (all live from chain/DefiLlama instead).
- **[API cross-check]** WebSearch FLR price Aug 2026: CoinMarketCap $0.006071, Coinbase $0.005975,
  ATL $0.00588 on 2026-08-05 — corroborates FTSO $0.0059951 and flags elevated recent FLR volatility.
- App/API endpoints `mystic.finance` (parked/for-sale), `mysticfinance.org` (marketing),
  `app.mysticfinance.xyz/api/markets` (returns SPA HTML, no JSON API) — noted as dead-ends for
  machine data; hence direct-contract + DefiLlama approach.

## Derived / computed (LIVE inputs, my computation)

- **[LIVE-derived]** Per-market utilization = totalBorrowAssets/totalSupplyAssets. Vault-weighted
  utilization: FXRP 83.0%, USDT0 84.9%, WFLR 94.3%.
- **[LIVE-derived]** borrowAPY from AdaptiveCurveIrm curve (kink 90%, steepness 4x) at current util
  using on-chain rateAtTarget; supplyAPY = borrowAPY×util×(1−10% perf fee), vault-weighted. Results:
  FXRP 0.68%, USDT0 3.37%, WFLR 4.71% — matching DefiLlama to ~0.1pp for USDT0/WFLR (validation).
- **[LIVE-derived]** Available (instant) liquidity = Σ min(adapterAssetsInMarket, marketIdle), plus
  vault idle buffer for FXRP. FXRP ~$1.2M, USDT0 ~$3.19M, WFLR ~$0.03M.

## ESTIMATES (clearly labeled, not from a live source)

- **[ESTIMATE]** Annualized volatility: FXRP ~0.55 (XRP proxy), WFLR ~0.80 (FLR at ATL, elevated),
  USDT0 ~0.01 (stable depeg proxy). Reasoning: typical crypto 30-90d realized vol ranges; FLR flagged
  higher due to all-time-low + thin liquidity. No precise historical vol series computed.
- **[ESTIMATE]** USDT0 price = $1.00 (assumed peg).
- **[ESTIMATE]** pairwiseCorrelation matrix (FXRP-WFLR 0.45, both ~0 to USDT0): reasoned from XRP-FLR
  co-movement (shared crypto beta + FLR being an XRP-ecosystem asset) and USDT0 being a stablecoin.
- **[ESTIMATE]** AdaptiveCurveIrm steepness=4x and target=90% are the Morpho-standard curve
  parameters (not re-read from the IRM contract's internal constants); rateAtTarget IS live on-chain.
