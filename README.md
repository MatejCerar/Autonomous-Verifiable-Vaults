# AVV with the real Flare TEE

Autonomous Verifiable Vaults, real-TEE version. A curator's allocation model runs
inside a Flare Confidential Compute enclave and signs each rebalance plan; an
on-chain `CurationController` verifies the TEE signature, the model fingerprint,
and the mandate caps before moving any funds. Verify instead of trust. Worked
example: Mystic-style venues on Coston2 (FXRP, USDT0, WFLR).

Two parts wired into one system: the enforcement backend (`contracts/`) and a
real Flare enclave (`tee-extension/`) that computes and signs the plan. The
frontend (`src/`) is the vault dashboard with the button that runs a cycle.

## Run it

The contracts are already live on Coston2 (nothing to deploy). You need the
enclave running (the real TEE) and the frontend.

### Frontend

```
npm install
npm run dev        # http://localhost:3000
```

The button talks to the enclave via `GATEWAY_URL` in `src/tee.config.ts`, so an
enclave must be reachable at that URL.

### Enclave (the real TEE)

The enclave is the Flare `tee-node` running your model and holding the signing
key, packaged by Flare as a Docker stack. You run it on any machine you control (a
laptop or a small VM). Coston2 gives you the shared coordination layer (on-chain
manager, tee-proxy, indexer), but the node that runs your model is yours, the same
way you run your own validator. In production it runs on a GCP Confidential Space
VM with real hardware attestation; here it runs with simulated attestation.

Steps are in `tee-extension/DEPLOY.md`. In short: clone the
`fce-extension-scaffold`, drop in `tee-extension/extension/*`, fill the env
(`TEE_PLAN_SIGNER_KEY` whose address is `MandateRegistry.teeAddress`, and
`AVV_CONTROLLER`), then `./scripts/full-setup.sh --chain coston2`. Then run the
gateway the browser calls and expose it:

```
node tee-extension/enclave-gateway.mjs         # forwards to the tee-node, on :8799
cloudflared tunnel --url http://localhost:8799 # gives a public URL
```

Put that URL in `GATEWAY_URL` in `src/tee.config.ts`. For a durable demo, run this
on a VM with a named tunnel (a quick tunnel is ephemeral).

## What one click does

1. Read `CurationController.nonce()` from Coston2.
2. Send `{market snapshot, nonce}` to the enclave (via the gateway).
3. The enclave runs the optimizer and EIP-191-signs the plan INSIDE the TEE, and
   returns `abi.encode(Plan, signature)`.
4. The frontend decodes `(plan, signature)`.
5. The frontend calls `CurationController.executePlan(plan, signature)` on
   Coston2, which verifies and enforces the plan and moves funds through the
   adapters.

Live FTSO prices are read from Coston2.

## The enforcement backend (contracts/)

`CurationController.executePlan(plan, signature)` runs eight ordered checks and
reverts BEFORE any funds move on a bad plan:

1. replay: `planId` not seen before.
2. nonce: `plan.nonce == controller.nonce()`.
3. expiry: `plan.expiry > block.timestamp`.
4. model fingerprint: `(modelVersion, codeHash)` is enabled in MandateRegistry.
5. TEE signature: `ecrecover` of the plan hash equals `MandateRegistry.teeAddress`.
6. mandate caps vs live vault TVL: reserve floor 20 percent, total-out cap 100
   percent, per-venue cap 30 percent.
7. totals identity: `sum(allocations) + reserveAmount == totalOut`.
8. route: reclaim what is deployed, pull `totalOut`, forward each allocation to
   its VenueAdapter, park the reserve, reconcile.

Components: `MandateRegistry` (the mandate: teeAddress, fingerprints, caps),
`CurationController` (verifier + router), `AutomatedCurationVault` (ERC-4626
custody), `VenueAdapter` x3 and `ReserveAdapter`, and 3 mock ERC-4626 venues
(Mystic is mainnet-only). The signed-plan format is frozen in `schema/preimage.md`.

## Where the model goes

The model is the optimizer, and it runs inside the TEE:

- `tee-extension/extension/vendor/optimize.ts` : the optimizer (pure, no network).
- `tee-extension/extension/avv.ts` : `buildPlan` maps weights to the `PlanLib.Plan`
  tuple (venue order 0=FXRP, 1=USDT0, 2=WFLR).
- `tee-extension/extension/handlers.ts` : the enclave handler that builds the
  plan, EIP-191-signs the preimage, and returns `abi.encode(Plan, signature)`.

To swap in your own model, replace the optimizer and `buildPlan`. It must emit a
`PlanLib.Plan`; the enclave signs it and the on-chain checks are unchanged.

## Real vs simulated

Real: live FTSO prices, the optimizer, the enclave EIP-191 signing, and the
on-chain verification, enforcement, and fund movement. All contracts are verified
on Blockscout.

Simulated: only the hardware attestation (`SIMULATED_TEE=true`), and the mock
ERC-4626 venues standing in for Mystic (mainnet-only).

## Deployed on Coston2 (chain id 114, verified on Blockscout)

| Contract | Address |
| --- | --- |
| CurationController | `0x47A4E99f26F3ABF95Ca09f81399ECf84b04F3909` |
| MandateRegistry | `0x9b584c252eaaBB933E81d0BA609F864b7278b52E` |
| AutomatedCurationVault (proxy) | `0x314f4B42245829742F1453cc676e784C92CAD47C` |
| MockStable (asset) | `0x0e81306c8d54Ba8D38AB5f220AeBD10F5b651c47` |
| ReserveAdapter | `0x92C89b41b87E605784778374dc2bA94ceBCab492` |
| VenueAdapter FXRP / USDT0 / WFLR | `0x73F2...ed97` / `0x5ECB...Cd4a` / `0x1dD7...B8Da` |
| teeAddress (enclave plan-signer) | `0xd50950812E6A6843633e8e4d51ADDFB4Ccc59584` |

Explorer: https://coston2-explorer.flare.network . `GATEWAY_URL` in
`src/tee.config.ts` is set per enclave deploy (a quick tunnel is ephemeral).

## Repo layout

- `contracts/` : the enforcement backend + deploy scripts.
- `tee-extension/` : the enclave model + handler, `enclave-gateway.mjs`, `DEPLOY.md`.
- `schema/` : the frozen signed-plan preimage (the integration contract).
- `src/` : the vault dashboard frontend (React + Vite + viem).
- `onchain/` : the legacy `AllocationDisplay` vault (optional, not enforcement).
- `ARCHITECTURE.md` : cycle data flow and the trust boundary.
