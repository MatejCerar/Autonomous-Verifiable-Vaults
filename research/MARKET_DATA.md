# Mystic Finance on Flare — Market Data Snapshot

**As of:** 2026-08-13 ~07:24 UTC | **Chain:** Flare mainnet (chainId 14)
**Protocol:** Mystic Finance = front-end / orchestration over a **standalone Morpho Blue** deployment.
**App URL (verified):** https://app.mysticfinance.xyz (the older `mystic.finance` domain is parked/for-sale; `mysticfinance.org` is a marketing page).

> Morpho's hosted API/SDK excludes chainId 14, so every market number below is read **directly from
> Morpho Blue on-chain** and rates recomputed from AdaptiveCurveIrm. Headline supply APY is
> cross-checked against the DefiLlama yields API (`project = mystic-finance-lending`, chain `Flare`).

## Vault architecture (corrected from older notes)

The three "Core" vaults are **Morpho Vault V2** ERC-4626 vaults (adapter-based), **not** MetaMorpho V1.
That is why the old `withdrawQueueLength()/supplyQueueLength()/fee()` calls revert — V2 replaced queues
with **adapters + absolute/relative caps + performanceFee/managementFee**. Each vault has exactly **1
liquidity adapter**, and each adapter supplies into **3 underlying Morpho Blue markets**.

```
Core FXRP  vault 0x53184a… -> adapter 0x0A3dEF… -> 3 Morpho markets (loan=FXRP)
Core USDT0 vault 0xE8dd6A… -> adapter 0xd29E73… -> 3 Morpho markets (loan=USDT0)
Core wFLR  vault 0x1aEadA… -> adapter 0x09E0b7… -> 3 Morpho markets (loan=WFLR)
```
All three: `curator = 0x72882e…`, `performanceFee = 10%` (1e17/1e18), `managementFee = 0`,
`morpho = 0xF4346F…`, IRM `= AdaptiveCurveIrm 0xE5B562…`. All market fees on-chain = 0.

## Summary table

| Asset | Vault (ERC-4626) | asset() ✓ | Supply APY | On-chain recompute | Utilization | TVL (USD) | Instant liquidity | Dominant LLTV | Perf fee | Price (USD) | Ann. vol |
|-------|------------------|-----------|-----------:|-------------------:|------------:|----------:|------------------:|--------------:|---------:|------------:|---------:|
| **FXRP**  | Core FXRP `0x53184a…` | FXRP ✓ | **0.37%** | 0.68% | **83.0%** | $2.20M | ~$1.2M | 62.5% | 10% | $1.0131 | ~0.55 (est) |
| **USDT0** | Core USDT0 `0xE8dd6A…` | USD₮0 ✓ | **3.28%** | 3.37% | **84.9%** | $21.07M | ~$3.19M | 77% | 10% | $1.0000 (peg) | ~0.01 (est) |
| **WFLR**  | Core wFLR `0x1aEadA…` | WFLR ✓ | **4.59%** | 4.71% | **94.3%** | $0.56M | ~$0.03M | 86% | 10% | $0.0059951 | ~0.80 (est) |

Supply APY = DefiLlama headline (apyBase; apyReward = null for all three). "On-chain recompute" =
borrowAPY × utilization × (1 − 10% perf fee), vault-weighted across the 3 markets. The two match to
~0.1pp for USDT0 and WFLR, validating the method; FXRP differs slightly (DefiLlama uses a smoothed
window). **Take DefiLlama as the headline; on-chain as the mechanism/marginal model.**

## Verified addresses & decimals (all live on-chain)

| Thing | Address | dec | Verified via |
|-------|---------|----:|--------------|
| FXRP token | `0xAd552A648C74D49E10027AB8a618A3ad4901c5bE` | 6 | symbol()="FXRP", decimals()=6 |
| USDT0 token | `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` | 6 | symbol()="USD₮0", decimals()=6 |
| WFLR token | `0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d` | 18 | symbol()="WFLR", decimals()=18 |
| Core FXRP vault | `0x53184aDaBF312b490BF1EbcFdC896FEfF6019a14` | 18 | name()="Core FXRP", symbol()="CSXRP", asset()=FXRP ✓ |
| Core USDT0 vault | `0xE8dd6A1e13244A27bDaa19CcBf33013647C675d1` | 18 | name()="Core USDT0", symbol()="COREUSDT0", asset()=USDT0 ✓ |
| Core wFLR vault | `0x1aEadA3C251215f1294720B80FcB3D1D005F3585` | 18 | name()="Core wFLR", symbol()="COREWFLR", asset()=WFLR ✓ |
| Morpho Blue | `0xF4346F5132e810f80a28487a79c7559d9797E8B0` | — | adapter.morpho() confirms |
| AdaptiveCurveIrm | `0xE5B5627C5973AfAE1928a6b8e5c1D6AABFEC8a7a` | — | idToMarketParams.irm for all 9 markets |

**All 3 addresses from the notes are CORRECT.** No corrections needed. Share prices (assetsPerShare):
FXRP 1.000432, USDT0 1.018430, WFLR 1.002845 (share prices > 1 = accrued interest since inception).

## Underlying Morpho markets (per vault, on-chain)

Fields from `Morpho.market(id) = (totalSupplyAssets, totalSupplyShares, totalBorrowAssets,
totalBorrowShares, lastUpdate, fee)`. Utilization = totalBorrow/totalSupply. Collateral token from
`idToMarketParams`. Weight = share of that vault-adapter's supplied assets.

**Core FXRP** (loan = FXRP, 6 dec):
| market id (short) | collateral | LLTV | util | borrowAPY | supplyAPY | weight |
|---|---|---:|---:|---:|---:|---:|
| d5e4b4… | USDT0 | 77.0% | 10.1% | 0.03% | 0.003% | 6.0% |
| 6b8a18… | 0x4C18Ff… | 62.5% | **88.5%** | 0.91% | 0.81% | **93.1%** |
| ffa796… | 0x04304B… | 77.0% | 4.8% | 0.03% | 0.001% | 0.9% |

**Core USDT0** (loan = USDT0, 6 dec):
| market id (short) | collateral | LLTV | util | borrowAPY | supplyAPY | weight |
|---|---|---:|---:|---:|---:|---:|
| e2e993… | WFLR | 62.5% | 90.5% | 13.46% | 12.17% | 0.5% |
| 2f31ab… | FXRP | 77.0% | **85.2%** | 4.36% | 3.71% | **98.5%** |
| 1f02ff… | 0x4C18Ff… | 62.5% | 52.0% | 4.33% | 2.25% | 1.0% |

**Core wFLR** (loan = WFLR, 18 dec):
| market id (short) | collateral | LLTV | util | borrowAPY | supplyAPY | weight |
|---|---|---:|---:|---:|---:|---:|
| d5548b… | USDT0 | 62.5% | 98.2% | 0.40% | 0.39% | 2.4% |
| f87b6f… | FXRP | 62.5% | **98.6%** | 4.49% | 4.42% | 30.4% |
| 0e0a9c… | 0x0988C6… | 86.0% | **92.3%** | 6.26% | 5.77% | **67.3%** |

## The graphs (APY / TVL trends — DefiLlama chart API, last 8 days)

**USDT0 (COREUSDT0)** — APY choppy 2.5-4.8%, mean-reverting; TVL flat ~$21M.
```
08-06 2.54%  $21.69M | 08-10 3.28%  $21.65M
08-07 2.91%  $21.64M | 08-11 4.77%  $20.90M  <- borrow spike
08-08 2.54%  $21.64M | 08-12 2.91%  $21.18M
08-09 2.54%  $21.65M | 08-13 3.28%  $21.07M  (30d mean 8.45%, i.e. it ran hotter earlier in the month)
```
**FXRP (CSXRP)** — APY pinned ~0.37% (twice dipped to 0% when a borrower repaid). TVL stepped
DOWN from ~$2.9M to ~$2.2M around 08-10 (a supplier withdrew ~$0.7M). Thin, quiet market.
```
08-06 0.37% $2.92M | 08-10 0.37% $2.20M  <- ~$0.7M supplier exit
08-07 0.00% $2.88M | 08-11 0.37% $2.22M
08-08 0.00% $2.94M | 08-12 0.37% $2.19M
08-09 0.37% $2.93M | 08-13 0.37% $2.20M  (30d mean 1.05%)
```
**WFLR (COREWFLR)** — APY grinding UP 3.4% -> 4.6% as utilization climbs; TVL small & flat ~$0.56M.
```
08-06 3.71% $0.583M | 08-10 4.20% $0.573M
08-07 3.38% $0.589M | 08-11 4.30% $0.566M
08-08 3.60% $0.599M | 08-12 4.52% $0.557M
08-09 3.85% $0.573M | 08-13 4.59% $0.561M  (30d mean 6.15% -> trending down over the month but up this week)
```

## FTSO prices (live on-chain, FtsoV2 `0x7BDE3D…`, feed ts 2026-08-13T07:19:35Z)

- **FLR/USD = $0.0059951** (raw 599510, dec 8). Cross-check: CoinMarketCap $0.006071, Coinbase
  $0.005975. FLR is near its **all-time low** ($0.00588 on 2026-08-05) — elevated recent volatility.
- **XRP/USD = $1.013054** (raw 1013054, dec 6).
- **USDT0** treated as **$1.00 peg** (LayerZero-bridged USDT); small depeg tail assumed.

## Raw proof (selected `cast call` outputs)

```
# Vault identity + balances (RPC https://flare-api.flare.network/ext/C/rpc)
Core FXRP  name="Core FXRP"  symbol="CSXRP"     dec=18  asset=0xAd552A…(FXRP ✓)  totalAssets=2181370558200 (=2,181,370.56 FXRP)  totalSupply=2180427438063322467759385
Core USDT0 name="Core USDT0" symbol="COREUSDT0" dec=18  asset=0xe7cd86…(USDT0 ✓) totalAssets=21094814832348 (=21,094,814.83)          totalSupply=20713042121901753469590316
Core wFLR  name="Core wFLR"  symbol="COREWFLR"  dec=18  asset=0x1D80c4…(WFLR ✓)  totalAssets=93175628728072353534337933 (=93,175,628.73 WFLR) totalSupply=92911297439614909663360653

# Share prices convertToAssets(1e18)
FXRP  -> 1000432   (1e6 base -> 1.000432 FXRP/share)
USDT0 -> 1018430   (1e6 base -> 1.018430 USDT0/share)
WFLR  -> 1002844978934167414 (1e18 base -> 1.002845 WFLR/share)

# Vault V2 config
performanceFee=100000000000000000 (=10%)  managementFee=0  (all 3)
maxRate: FXRP/WFLR 4756468797/s (~15% APR cap)  USDT0 63419583967/s (~200% APR cap)
adaptersLength=1 each

# Morpho Blue market() for the dominant market of each vault
FXRP  6b8a18…: supplyAssets=1071894562914  borrowAssets=948361042275  -> util 88.48%
USDT0 2f31ab…: supplyAssets=20771675081313 borrowAssets=17696108738649 -> util 85.19%
WFLR  0e0a9c…: supplyAssets=62664343583848393148105193 borrowAssets=57810418597837808250699751 -> util 92.25%

# AdaptiveCurveIrm rateAtTarget(id) (per-sec WAD) dominant markets
FXRP 291842396 | USDT0 1409185676 | WFLR 1148093065

# FTSO V2
FLR/USD getFeedById -> value=599510  dec=8  ts=1786605575
XRP/USD getFeedById -> value=1013054 dec=6  ts=1786605575
```

## IRM shape (for the optimizer's marginal-yield model)

AdaptiveCurveIrm has a **kink at 90% target utilization**, steepness 4x:
- **u ≤ 90%:** borrow rate rises linearly from `rateAtTarget/4` (at u=0) to `rateAtTarget` (at u=90%).
- **u > 90%:** borrow rate rises steeply, up to `4 × rateAtTarget` at u=100%. Additionally
  `rateAtTarget` itself **drifts upward** the longer utilization stays above target (adaptive term),
  so a persistently hot market keeps getting more expensive to borrow (good for suppliers, until
  borrowers repay).
- **Supply APY = borrowAPY × utilization** (market fee = 0 here), then the vault skims **10%**.

**Marginal yield vs deposit size:** a new deposit `d` into a market with supply `S`, borrow `B` moves
utilization from `B/S` to `B/(S+d)`. Supply APY moves roughly with utilization, so **your marginal
APY falls as you deposit more** — steeply if the market was above the 90% kink (WFLR: sitting at
92-99% util, so it de-rates fast on inflow), gently if it was below (FXRP dominant market at 88%).
This is the diminishing-returns curve the optimizer must respect (see STRATEGY.md).
