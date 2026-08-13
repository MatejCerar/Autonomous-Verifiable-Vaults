# Automated Curation (Autonomous Verifiable Vaults)

A curator runs their allocation model **inside a TEE** and every rebalance is
**enforced on-chain**. The model stays private; each cycle it reads its inputs,
produces an allocation plan, and signs it with a key that only exists inside the
enclave. An on-chain `CurationController` verifies that signature and the model's
code fingerprint, checks the plan against a mandate (per-venue caps, reserve floor,
freshness, replay), and only then moves funds. Anything outside the mandate reverts
before a token moves. Autonomous rebalancing you can **verify instead of trust**.

The worked example targets **Mystic Finance** (Morpho on Flare) with three venues:
FXRP, USDT0, WFLR.

## The live demo

```bash
bash ui.sh          # -> http://localhost:3000
```

Set the capital, click **Start cycle**, and each click, live in the browser:

1. reads the **live market**: FTSO prices on-chain (FLR/USD, XRP/USD) + Mystic supply
   APY / TVL from DefiLlama + vault balances on-chain,
2. runs the **allocation model** and shows what it would do: weights, reserve,
   expected APY (the numbers move because the inputs moved),
3. the model **signs the bounded plan** (TEE-signed, EIP-191) and the mandate caps are
   checked exactly as on-chain (30% per venue, 80% total-out, 20% reserve floor),
4. builds the **6 prepared transactions with full calldata hex** (approve + deposit
   per venue) for that allocation.

Click again and it re-reads the market. Nothing is broadcast: the transactions are
prepared for review and signing. See `optimizer/EQUATION.md` for the allocation math
and `prepared-txs/PREPARED_TX.md` for the calldata.

## What is real vs simulated

Real: the live market reads, the allocation optimizer (a deterministic, grid-verified
solver), the EIP-191 plan signing, the on-chain cap enforcement (contracts fork-tested
against the live Mystic vaults), and the prepared calldata. Simulated: only the
**hardware root of trust** - the demo signs with a throwaway key standing in for the
enclave. Swapping in a real `tee-node` enclave makes attestation real with no contract
change. Nothing is broadcast unless you deliberately sign and send.

## The prepared transactions

Step 5 emits the 6 real Flare-mainnet transactions that would deploy the allocation:
per venue, an ERC-20 `approve` then an ERC-4626 `deposit` into the Mystic Core vault,
with full calldata. To actually submit them you sign and broadcast with your own key
(the capital is a stablecoin notional, so acquiring FXRP/WFLR needs a DEX swap first -
noted in `prepared-txs/PREPARED_TX.md`). They are otherwise never sent.

## Where you plug in

1. **Your model** -> `tee-model/src/model.ts` (and the in-browser optimizer in
   `optimizer/`). It must emit a `Plan` and the service signs it per
   `schema/preimage.md`. The chain trusts only the TEE signer, the model fingerprint,
   and the caps - not the logic - so your model stays private and cannot exceed the
   mandate.
2. **Your markets** -> `contracts/src/MysticAddresses.sol` + `DeployMystic.s.sol`.
   `MysticVenueAdapter` works with any ERC-4626 vault.
3. **Your mandate** -> the caps in the deploy / `MandateRegistry` (per-venue cap,
   reserve floor).
4. **Your TEE** -> swap the simulated signer for a `tee-node` enclave; contracts
   unchanged, the signer's root of trust becomes hardware-attested.

## Layout

- `frontend/` - the live "Start cycle" walkthrough (React + Vite + viem).
- `optimizer/` - the allocation math (`EQUATION.md`) and solver (TS + Python).
- `tee-model/` - the model service that signs the bounded plan.
- `contracts/` - the enforcement layer (Foundry): `CurationController`,
  `MandateRegistry`, `AutomatedCurationVault` (ERC-4626), reserve + venue adapters,
  `MysticVenueAdapter`, `DeployMystic.s.sol`, and the fork test. Vendored deps are
  committed so `forge build` works from a clean clone.
- `prepared-txs/` - the unsigned mainnet transactions + builder.
- `research/` - the market snapshot used as the offline fallback.
- `schema/preimage.md` - the FROZEN signed-plan format (the model/chain contract).
- `prepare.sh` regenerates the offline snapshot + builds the contracts;
  `forktest.sh` fork-tests the adapters against live Mystic; `verify-handoff.sh`
  checks nothing unsafe would ship.

## Security

- Ship as a git repo / clean archive, not a folder copy. `TEE/` and all `.env` files
  are gitignored and must never ship. Verify with `bash verify-handoff.sh`.
- The demo signer is the well-known Anvil test key: fine for a demo, never for value.
