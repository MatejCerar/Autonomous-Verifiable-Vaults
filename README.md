# AVV with the real Flare TEE

Autonomous Verifiable Vaults, real-TEE version. A curator's allocation model runs
inside a Flare Confidential Compute enclave and signs each rebalance plan; an
on-chain `CurationController` verifies the TEE signature, the model fingerprint,
and the mandate caps before moving any funds. Verify instead of trust. Worked
example: Mystic-style venues on Coston2 (FXRP, USDT0, WFLR).

Two parts wired into one system: the enforcement backend (`contracts/`) and a
real Flare enclave (`tee-extension/`) that computes and signs the plan. The
frontend (`src/`) is the vault dashboard with the button that runs a cycle.

## Two ways to use this

1. **Try the demo (no setup).** Open the frontend. It talks to a running enclave
   (the one whose URL is in `src/tee.config.ts`) and runs full cycles on Coston2:
   read the live market, sign the plan in the TEE, enforce it on-chain, move
   funds. You are running the shipped model; you cannot change it from the
   browser. This is enough to see the whole "verify instead of trust" loop work.

2. **Run your own model (needs Docker).** To swap in your own allocation model
   you run your own enclave: bring up the enclave stack (see "Run it" below and
   `tee-extension/SERVER.md`), replace the optimizer in
   `tee-extension/extension/vendor/optimize.ts` (and `buildPlan` in `avv.ts`),
   register your model fingerprint and signer, then point `GATEWAY_URL` at your
   enclave. The contracts and the frozen plan format do not change; only your
   model does. See "Where the model goes".

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

Easiest way (Docker only, see `tee-extension/SERVER.md`): the repo ships a
single-file enclave service plus a compose file that also runs a public tunnel.
On any server with Docker:

```
git clone https://github.com/MatejCerar/Autonomous-Verifiable-Vaults.git
cd Autonomous-Verifiable-Vaults/tee-extension
docker compose -f docker-compose.enclave.yml up -d
docker compose -f docker-compose.enclave.yml logs tunnel | grep trycloudflare
```

Put the printed `https://<slug>.trycloudflare.com` URL in `GATEWAY_URL` in
`src/tee.config.ts` and rebuild the frontend. That service reads the live Mystic
market, runs the optimizer, and signs the plan (the same model + signing code the
enclave runs).

Full FCC tee-node (the real on-chain message bus + attestation). The heavier path:
the model runs inside a registered Flare tee-node built from Flare's scaffold
(https://github.com/flare-foundation/fce-extension-scaffold). One command from the
repo root sets it up:

```
./setup-scaffold.sh
```

It clones the scaffold, version-matches it to Coston2, and wires the AVV extension
in. You then fill two funded keys plus the Coston2 indexer `[db]` creds (from
Flare) and deploy. The full steps, the version patches, and the DB config are in
`tee-extension/COSTON2-FCC.md`. This path is the only one that needs the indexer
DB; the gateway service above does not.

## What one click does

1. Read `CurationController.nonce()` from Coston2.
2. Ask the enclave for a plan (send the nonce).
3. The enclave reads the LIVE Mystic market (FTSO prices + DefiLlama APY/TVL),
   runs the optimizer, and EIP-191-signs the plan INSIDE the TEE, returning
   `abi.encode(Plan, signature)`.
4. The frontend decodes `(plan, signature)`.
5. The frontend calls `CurationController.executePlan(plan, signature)` on
   Coston2, which verifies and enforces the plan and moves funds through the
   adapters.

The frontend also shows the live market (venue APY/util) via the enclave's
`/market` endpoint.

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
`PlanLib.Plan`; the enclave signs it and the on-chain checks are unchanged. Doing
this means running your own enclave (the Docker stack), because the model lives
inside the enclave, not in the browser: the frontend cannot change the model, it
only asks whatever enclave `GATEWAY_URL` points at for a signed plan. So trying
the demo uses the shipped model; using your own model means standing up your own
enclave and pointing `GATEWAY_URL` at it.

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
