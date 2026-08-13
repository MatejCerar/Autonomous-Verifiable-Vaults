# Prepared transactions - Mystic Core allocation (Flare mainnet)

> DO NOT EXECUTE WITHOUT REVIEW. These transactions are PREPARED, NOT SIGNED and
> NOT BROADCAST. They target Flare MAINNET (chainId 14) and would move real
> funds into the live Mystic Core ERC-4626 vaults. Read every field, replace the
> placeholders, and simulate before you ever sign.

## What this is

Mystic Finance runs on Flare mainnet only (no testnet deployment). We will not
execute on mainnet in this demo. So instead of signing, we PREPARE the exact,
correct, broadcastable-later calldata that would deploy the optimizer's chosen
allocation into the three real Mystic Core vaults.

- Weights come from `optimizer/result.json` (optimizer output over live data).
- Prices, decimals, token and vault addresses come from `research/market-data.json`
  (cross-checked against `contracts/src/MysticAddresses.sol`).
- The full bundle is regenerated deterministically by `build.mjs` -> `bundle.json`.
  Nothing is hand-written magic; every number is reproducible from the two input
  JSONs.

## Inputs and conventions

- Capital `C` = 1,000,000 USD notional (from `result.json.capital`).
- Venue ids (canonical, match TEE + contracts workers): `0 = FXRP, 1 = USDT0, 2 = WFLR`.
- Per-venue USD amount = `C * weight_i`.
- Native token amount = `floor( (C * weight_i) / priceUsd_i * 10^decimals_i )`.
- Reserve stays undeployed. No transaction is produced for it.

## Allocation table

| Venue | id | Weight | USD | Price (USD) | Dec | Token amount (base units) | Token amount (whole) |
|-------|----|--------|-----|-------------|-----|---------------------------|----------------------|
| FXRP  | 0  | 0.08475   | 84,750.00  | 1.013054   | 6  | 83657929389                 | 83,657.929389 FXRP |
| USDT0 | 1  | 0.30      | 300,000.00 | 1.0        | 6  | 300000000000                | 300,000.000000 USDT0 |
| WFLR  | 2  | 0.031759  | 31,759.00  | 0.0059951  | 18 | 5297492952577939257025718   | 5,297,492.952577939257 WFLR |
| Reserve | - | 0.583491 | 583,491.00 | -         | -  | (undeployed)                | (undeployed) |

- Sum deployed USD = 84,750 + 300,000 + 31,759 = 416,509 = `C * (1 - reserve)`
  = 1,000,000 * (1 - 0.583491). Drift vs the reserve figure: $0.00.
- Each token amount was recomputed from `USD / price * 10^decimals` (floor) and
  matches `result.json.perVenue[*].tokenAmount` to the base unit.

## The 6 prepared transactions (ordered)

Ordering rule: for each venue, `approve` (on the token) BEFORE `deposit` (on the
vault). Venues in id order 0, 1, 2. The ERC-4626 `deposit` pulls `assets` from
the sender via `transferFrom`, so the allowance must exist first.

Common fields: `chainId: 14`, `value: 0x0`, `from: {{SENDER}}` (broadcaster EOA),
`receiver` = `0x0000000000000000000000000000000000000001` (placeholder curator;
replace with the deployed CurationController or curator EOA before broadcast).

Selectors: `approve(address,uint256)` = `0x095ea7b3`,
`deposit(uint256,address)` = `0x6e553f65`.

### 1. approve FXRP -> Core FXRP vault
- `to` (FXRP token): `0xAd552A648C74D49E10027AB8a618A3ad4901c5bE`
- fn: `approve(address spender, uint256 amount)`
- spender: `0x53184aDaBF312b490BF1EbcFdC896FEfF6019a14` (Core FXRP vault)
- amount: `83657929389`

### 2. deposit FXRP into Core FXRP vault
- `to` (Core FXRP vault): `0x53184aDaBF312b490BF1EbcFdC896FEfF6019a14`
- fn: `deposit(uint256 assets, address receiver)`
- assets: `83657929389`
- receiver: `0x0000000000000000000000000000000000000001`

### 3. approve USDT0 -> Core USDT0 vault
- `to` (USDT0 token): `0xe7cd86e13AC4309349F30B3435a9d337750fC82D`
- fn: `approve(address spender, uint256 amount)`
- spender: `0xE8dd6A1e13244A27bDaa19CcBf33013647C675d1` (Core USDT0 vault)
- amount: `300000000000`

### 4. deposit USDT0 into Core USDT0 vault
- `to` (Core USDT0 vault): `0xE8dd6A1e13244A27bDaa19CcBf33013647C675d1`
- fn: `deposit(uint256 assets, address receiver)`
- assets: `300000000000`
- receiver: `0x0000000000000000000000000000000000000001`

### 5. approve WFLR -> Core wFLR vault
- `to` (WFLR token): `0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d`
- fn: `approve(address spender, uint256 amount)`
- spender: `0x1aEadA3C251215f1294720B80FcB3D1D005F3585` (Core wFLR vault)
- amount: `5297492952577939257025718`

### 6. deposit WFLR into Core wFLR vault
- `to` (Core wFLR vault): `0x1aEadA3C251215f1294720B80FcB3D1D005F3585`
- fn: `deposit(uint256 assets, address receiver)`
- assets: `5297492952577939257025718`
- receiver: `0x0000000000000000000000000000000000000001`

The raw `data` blobs live in `bundle.json`. Each was verified by re-decoding the
calldata (selector + 32-byte-padded args) and asserting it matches the intended
arguments. Each blob is 68 bytes: 4-byte selector + two 32-byte words.

## Prerequisite: the swap step (capital is USD notional)

`C` is a USD notional. The bundle assumes the sender already HOLDS the exact
native token for each venue. In practice a treasury holds one stable asset
(USDT0). To fund the FXRP and WFLR legs you must FIRST swap USDT0 (or another
held asset) into FXRP and WFLR on a Flare DEX before the approve+deposit legs:

- FXRP leg: swap ~84,750 USDT0 -> ~83,657.93 FXRP.
- WFLR leg: swap ~31,759 USDT0 -> ~5,297,492.95 WFLR.
- USDT0 leg: no swap needed (300,000 USDT0 deposited directly).

Candidate venues on Flare: SparkDEX and Enosys. Router calldata for the swaps is
intentionally NOT included here: we do not fabricate a router address or its
encoded path without verifying it live. Add verified swap txs ahead of the
matching approve+deposit legs if you route through a DEX. Slippage and price
impact on the thin WFLR / FXRP books must be checked at execution time.

## How to broadcast later (only after review)

Substitute placeholders first: set `{{SENDER}}` to your broadcaster address and
replace the `0x00..01` receiver with the real curator / CurationController.

Using `cast` (Foundry), one tx at a time, in order:

```
# example: tx 1 (approve FXRP). RPC = a Flare mainnet endpoint, chainId 14.
cast send 0xAd552A648C74D49E10027AB8a618A3ad4901c5bE \
  "approve(address,uint256)" \
  0x53184aDaBF312b490BF1EbcFdC896FEfF6019a14 83657929389 \
  --rpc-url $FLARE_RPC --chain 14 --ledger   # or --private-key (never paste in chat)
```

Or paste each `{to, value, data}` from `bundle.json` into a wallet (Safe,
MetaMask) and confirm the decoded action matches this document before signing.
Simulate with `cast call` / `eth_call` or a fork (`anvil --fork-url`) first.

> Reminder: DO NOT EXECUTE WITHOUT REVIEW. Mainnet, real funds, irreversible.

## Reserve

58.3491% of capital ($583,491) is deliberately left undeployed as reserve. It is
documented here and has no transaction. The optimizer's reserve floor was 20%;
water-filling pushed the actual reserve higher because marginal risk-adjusted
yield hit the water line before more capital was worth deploying.

## Regenerate

```
cd prepared-txs
node build.mjs      # reads ../optimizer/result.json + ../research/market-data.json
```

If `result.json` or `market-data.json` change, re-run to regenerate `bundle.json`.
The script self-checks selectors, decodes every blob, and asserts the deployed
USD sum equals `C * (1 - reserve)`.
