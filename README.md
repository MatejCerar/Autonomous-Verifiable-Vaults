# AVV with the real Flare TEE

This project is the real-TEE version of the Autonomous Verifiable Vaults (AVV)
demo. It takes two pieces that used to live apart and wires them into one
end-to-end system on Coston2:

1. The full AVV enforcement backend (the `demo/` project), now in `contracts/`:
   an on-chain verifier and vault that will only move funds when it is handed a
   plan that passes eight ordered checks.
2. The real Flare Confidential Compute (FCC) TEE: the allocation model runs
   INSIDE a Flare enclave (the `fce-extension-scaffold` tee-node), computes the
   plan, and EIP-191-signs the plan preimage with an enclave-held key. That
   signer address is the `teeAddress` the on-chain verifier checks against.

In the sibling `demo/` the enclave signer was simulated in a browser. Here it is
a real enclave. Everything downstream (verify, enforce, move funds) is real and
on-chain.

## What it does, in one button press

The frontend runs one full cycle:

1. Read `CurationController.nonce()` from Coston2.
2. Send `{market snapshot, nonce}` to the enclave (via the InstructionSender
   contract and the ext-proxy).
3. The enclave computes the allocation plan with the AVV optimizer, INSIDE the
   TEE, and EIP-191-signs the plan preimage. It returns `abi.encode(Plan,
   signature)`.
4. The frontend decodes `(plan, signature)`.
5. The frontend calls `CurationController.executePlan(plan, signature)` on
   Coston2. The contract verifies the plan, enforces the mandate caps against
   live vault TVL, and moves funds through the adapters.

Live inputs (FTSO prices) are read from Coston2.

## The enforcement backend (contracts/)

`CurationController.executePlan(plan, signature)` is the single entry point. It
runs eight ordered checks and reverts BEFORE any adapter call, so no funds move
on a bad plan:

1. replay: `planId` not seen before.
2. nonce: `plan.nonce == controller.nonce()`, then increments.
3. expiry: `plan.expiry > block.timestamp`.
4. model fingerprint: `MandateRegistry.isVersionSupported(modelVersion,
   codeHash)` is true.
5. TEE signature: EIP-191 `ecrecover` of the plan hash equals
   `MandateRegistry.teeAddress()`.
6. mandate caps vs live vault TVL:
   - reserve floor: `reserveAmount >= 20% of TVL` (`minReserveBips`).
   - total out cap: `totalOut <= 100% of TVL` (`maxTotalOutBips`).
   - per-venue cap: each allocation `<= 30% of TVL` (`venueCapBips`).
7. totals identity: `sum(allocations) + reserveAmount == totalOut`.
8. route: reclaim everything currently deployed back to the vault (so a cycle is
   an idempotent full rebalance), pull `totalOut` from the vault, forward each
   allocation to its VenueAdapter, park the reserve in the ReserveAdapter, then
   reconcile.

The bips limits above are the deployed values. They are set in MandateRegistry
and can be changed by the owner; the contract enforces whatever is registered.

Components:

- `MandateRegistry`: the mandate. Holds the write-once `teeAddress`, the enabled
  `(modelVersion, codeHash)` fingerprints, and the hard bips limits.
- `CurationController` (UUPS): the verifier and enforcement router above.
- `AutomatedCurationVault` (ERC-4626, UUPS proxy): custody. Exposes
  `pullForCuration` and `reconcile` to the controller.
- `VenueAdapter` (x3) and `ReserveAdapter`: route funds into the venues and the
  defensive reserve sink.
- Mock ERC-4626 lending venues (x3): stand in for the real Mystic venues, which
  are mainnet-only.

The exact signed-plan format (struct, hash preimage, reject order) is frozen in
`schema/preimage.md`. Every component reproduces it byte-for-byte.

## Where does the model go

The model is the allocation optimizer. In this combined design it lives in the
enclave and runs INSIDE the TEE:

- `tee-extension/extension/vendor/optimize.ts` is the optimizer. It is pure and
  does no network I/O: given a market snapshot it returns per-venue weights by
  maximizing risk-adjusted yield (water-filling under per-venue, total-out, and
  reserve-floor constraints).
- `tee-extension/extension/avv.ts::buildPlan` invokes the optimizer and maps the
  weights into the on-chain `PlanLib.Plan` tuple (canonical venue order 0=FXRP,
  1=USDT0, 2=WFLR).
- `tee-extension/extension/handlers.ts::handleCurationCycle` is the enclave
  handler that decodes the instruction, calls `buildPlan`, EIP-191-signs the
  plan preimage with the enclave-held key, and returns `abi.encode(Plan,
  signature)`.

To swap in your own model, replace the optimizer and `buildPlan`. Your model
must emit a `PlanLib.Plan`; the enclave signs it and the on-chain checks are
unchanged. The frozen integration contract both sides agree on is
`schema/preimage.md`.

For contrast: in the sibling `demo/` the model lived in `tee-model/src/` and
`optimizer/`, and the enclave signer was only simulated. Here the same model
runs in a real enclave.

## What is real vs simulated

Real:

- Live FTSO prices read from Coston2.
- The AVV optimizer (the allocation math).
- Enclave EIP-191 signing of the plan preimage with the enclave-held key.
- On-chain verification, mandate enforcement, and fund movement in
  `CurationController.executePlan`.
- All contracts are fork-tested and deploy-tested, and verified on Blockscout.

Simulated:

- Only the hardware root of trust / attestation. The enclave runs with
  `SIMULATED_TEE=true`; the one value whose hardware attestation is simulated is
  the `codeHash` model fingerprint (see `schema/preimage.md`).
- The mock ERC-4626 venues stand in for Mystic, which is mainnet-only.

## Deployed on Coston2

Chain id 114. All contracts verified on Blockscout:
https://coston2-explorer.flare.network

| Contract | Address |
| --- | --- |
| CurationController | `0x47A4E99f26F3ABF95Ca09f81399ECf84b04F3909` |
| MandateRegistry | `0x9b584c252eaaBB933E81d0BA609F864b7278b52E` |
| AutomatedCurationVault (proxy) | `0x314f4B42245829742F1453cc676e784C92CAD47C` |
| MockStable (asset) | `0x0e81306c8d54Ba8D38AB5f220AeBD10F5b651c47` |
| ReserveAdapter | `0x92C89b41b87E605784778374dc2bA94ceBCab492` |
| VenueAdapter FXRP (venueId 0) | `0x73F2C8F8D33bD7df77770dE9652759d17af7ed97` |
| VenueAdapter USDT0 (venueId 1) | `0x5ECB52baddCEa77a5772c94a96040a875C7CCd4a` |
| VenueAdapter WFLR (venueId 2) | `0x1dD7de9Ea72b2478A9e8c99F22BcDC21bDe7B8Da` |
| MockLendingVenue 0 | `0xB221B5600EF901c49EEa8CFd258cE7c57D72C393` |
| MockLendingVenue 1 | `0x42393B07Fe2809709153AdFcdAB820a96b6A7a5d` |
| MockLendingVenue 2 | `0xd01eaEC225Def395dD26186Bb9d82da682509224` |
| teeAddress (enclave plan-signer) | `0xd50950812E6A6843633e8e4d51ADDFB4Ccc59584` |

The InstructionSender address and the ext-proxy tunnel URL are ephemeral: they
change on each TEE redeploy. See `src/tee.config.ts` after deploy for the current
values, not a fixed address here.

## How to run

The contracts are already live on Coston2 (nothing to deploy). You need two
things running: the enclave (the real TEE) and the frontend.

### Frontend

```
npm install
npm run dev        # http://localhost:3000
```

The button reads the live market, has the enclave compute + sign the plan, and
calls `CurationController.executePlan` on Coston2. It talks to the enclave via the
`GATEWAY_URL` in `src/tee.config.ts`, so an enclave must be running (next).

### Enclave (the real TEE)

The enclave is the Flare `tee-node` running your model and holding the signing
key. Flare ships it as a Docker stack, so running the TEE means running that stack
on a machine you control (a laptop or a small VM). There is no shared hosted
enclave that runs your model, the same way you would run your own validator. In
production it runs on a GCP Confidential Space VM (real hardware attestation); for
this demo it runs locally with simulated attestation.

Steps are in `tee-extension/DEPLOY.md`. In short: clone the
`fce-extension-scaffold`, drop in `tee-extension/extension/*`, fill the env
(including `TEE_PLAN_SIGNER_KEY` whose address is `MandateRegistry.teeAddress`,
and `AVV_CONTROLLER`), then `./scripts/full-setup.sh --chain coston2`. Then run
the small gateway the browser calls and expose it:

```
node tee-extension/enclave-gateway.mjs         # forwards to the tee-node, listens on :8799
cloudflared tunnel --url http://localhost:8799 # gives a public URL
```

Put that URL in `GATEWAY_URL` in `src/tee.config.ts`. For a durable public demo,
run this on a VM with a named tunnel (a quick tunnel is ephemeral).

## Repo layout

- `contracts/` : the enforcement backend (MandateRegistry, CurationController,
  AutomatedCurationVault, adapters, mock venues, `PlanLib`, deploy scripts).
- `tee-extension/` : the enclave model and handler (`extension/vendor/optimize.ts`,
  `extension/avv.ts`, `extension/handlers.ts`), the `InstructionSender.sol` entry
  point, `enclave-gateway.mjs` (the CORS gateway the frontend calls), and
  `DEPLOY.md`.
- `schema/` : the frozen signed-plan preimage (`preimage.md`) and JSON schema,
  the integration contract every component reproduces byte-for-byte.
- `src/` : the vault-style dashboard frontend (React + Vite + viem).
- `onchain/` : the legacy `AllocationDisplay` display vault. Optional; not part
  of the enforcement path.

## See also

- `ARCHITECTURE.md` : the cycle data flow and the trust boundary.
- `schema/preimage.md` : the frozen signed-plan preimage (the
  integration contract).
