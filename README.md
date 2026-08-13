# Automated Curation (Autonomous Verifiable Vaults)

A wrapper that lets a vault curator run their allocation model **inside a TEE** and
have every rebalance **enforced on-chain**. The curator's model stays private. Each
cycle it reads its inputs, produces an allocation plan, and signs that plan with a key
that only exists inside the enclave. An on-chain `CurationController` verifies the
signature and the model's code fingerprint, checks the plan against the mandate
(per-venue caps, a reserve floor, freshness, replay/nonce), and only then moves funds.
Anything outside the mandate reverts before a single token moves. The result is
autonomous rebalancing you can **verify instead of trust**.

The worked example targets **Mystic Finance** (Morpho on Flare) with three venues:
FXRP, USDT0, WFLR. You swap in your own model, markets, and mandate at the seams below
without touching the enforcement layer.

- Full map: `ARCHITECTURE.md`  -  the allocation math: `optimizer/EQUATION.md`
- Local run: `RUN.md`  -  what is real vs simulated: `STATUS.md`
- Production hardware attestation: `REAL_TEE.md`

## What is real vs simulated

Real: the on-chain enforcement (signature + code fingerprint + caps, a distinct revert
per rule), the ERC-4626 venue adapters (fork-tested against the live Mystic Core
vaults), the allocation optimizer (a deterministic, grid-verified solver), and the
EIP-191 plan signing. Simulated: only the **hardware root of trust** - the demo signs
with a throwaway key standing in for the enclave. Wiring a real `tee-node` enclave
(`REAL_TEE.md`) makes attestation real with no contract change. Nothing here is
broadcast unless you run a deploy/broadcast script with your own key.

## Run it locally (two terminals)

No chain, no keys. Prerequisites: node 20+, python3, foundry.

```bash
bash prepare.sh   # optimizer -> prepared txs -> TEE sign+verify -> contracts build
bash ui.sh        # the six-step walkthrough UI on http://localhost:3000
```

See `RUN.md`. The UI walks one cycle: live market inputs, the optimizer decision, the
TEE-signed plan, on-chain cap validation (including a bad-plan rejection), and the
prepared-but-not-broadcast transactions.

## Deploy it yourself

### Testnet (Coston2, mock venues) - recommended first

Coston2 has no Mystic, so the testnet deploy uses three mock ERC-4626 venues that
mirror the real structure. You get the full live loop (sign -> enforce -> route) with
fake money. Get C2FLR from https://faucet.flare.network/coston2.

```bash
export PK=0x<your funded Coston2 key>
bash scripts/deploy-testnet.sh     # deploys the stack, writes addresses.json
bash scripts/cycle.sh              # signs a plan and executes one cycle on-chain
bash scripts/cycle.sh --bad        # watch the chain reject an over-cap plan
```

### Proof: an unauthorized enclave is rejected on-chain

The strongest demonstration of the guarantee. A fully valid, in-mandate plan signed by
the **wrong** enclave key is rejected on-chain with `bad signer` - no funds move.

```bash
export PK=0x<funded Coston2 key>   # pays gas; the plan is signed by a separate rogue key
BROADCAST=1 bash scripts/prove-rejection.sh   # produces a real reverted tx + explorer link
```

See `scripts/SIGNED_REJECTION_PROOF.md`.

### Mainnet (Flare, real Mystic)

The venues are the live Mystic Core vaults. Deploy the wrapper with
`contracts/script/DeployMystic.s.sol`, then either run cycles through the controller or
use the prepared transactions in `prepared-txs/` for the direct deposits. Deploying the
wrapper costs only gas; deploying capital is your decision. Review
`prepared-txs/PREPARED_TX.md` (and the swap prerequisite) before broadcasting.

## Where you plug in (integration seams)

1. **Your model** -> `tee-model/src/model.ts`. Replace the optimizer call. It must emit
   a `Plan` (allocations `[venueId, amount]` + reserve) and the service signs it per
   `schema/preimage.md`. The chain trusts only the TEE signer, the model fingerprint
   (`codeHash`), and the caps - not the model's logic - so your model stays private and
   still cannot exceed the mandate.
2. **Your markets** -> `contracts/src/MysticAddresses.sol` + the deploy scripts.
   `MysticVenueAdapter` works with any ERC-4626 vault; `MockERC4626Vault` is the testnet
   stand-in.
3. **Your mandate** -> the caps in the deploy script / `MandateRegistry` (per-venue cap,
   reserve floor). The binding guards are the 30% per-venue cap and the 20% reserve
   floor. Tighten them live and the chain rejects even your own model's plan.
4. **Your TEE** -> swap the simulated signer for a `tee-node` enclave (`REAL_TEE.md`).
   Contracts are unchanged; only the signer's root of trust becomes hardware-attested.

## Layout

- `contracts/` - the enforcement layer (Foundry): `CurationController`,
  `MandateRegistry`, `AutomatedCurationVault` (ERC-4626), reserve + venue adapters
  (`MysticVenueAdapter` for real ERC-4626, `MockLendingVenue`/`MockERC4626Vault` for
  testnet). Deploy scripts + fork test. Vendored deps are committed, so `forge build`
  works from a clean clone.
- `tee-model/` - the model service that runs "inside the TEE" and signs the plan.
- `optimizer/` - the allocation math and solver (TS + Python).
- `research/` - the live Mystic market snapshot the example runs over.
- `prepared-txs/` - unsigned Flare-mainnet transactions for the chosen allocation.
- `frontend/` - the six-step walkthrough UI.
- `scripts/` - deploy + run-a-cycle + rejection-proof helpers.
- `schema/preimage.md` - the FROZEN signed-plan format (the model/chain contract).

## Security

- Hand this off as a **git repo / clean archive**, not a folder copy. `TEE/` and all
  `.env` files are gitignored and must never ship. Verify with `bash verify-handoff.sh`.
- All deploy scripts read the private key from the `PK` env var. Never hardcode a key.
- The demo signer is the well-known Anvil test key: fine for a demo, never for value.
- The `up.sh` / `down.sh` / docker / `TEE/` path is the optional real-hardware-TEE
  route; `TEE/` is not shipped (get `tee-node` from Flare's public repos per
  `REAL_TEE.md`). The default demo above needs none of it.
