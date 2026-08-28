# DEPLOY: AVV CURATION/CYCLE TEE extension on Coston2

This runbook stands up the AVV allocation model as a real Flare Confidential
Compute (FCC) TEE extension on Coston2, using the `fce-extension-scaffold`. The
enclave runs the AVV optimizer and returns an enclave-signed `PlanLib.Plan`; the
frontend (`demo-with-tee`) calls `sendCuration` and decodes that Plan.

Everything in this folder is SOURCE only. You copy it into a fresh scaffold
clone, fill secrets, and run the scaffold's setup script.

## 0. Prerequisites

Install on the deploy host (a Linux box or the Confidential Space VM):

- Docker (with compose) and permission to run it
- Go 1.25+ (the scaffold's Go tooling + cgo abigen)
- Foundry (`forge`, `cast`) for building/deploying `InstructionSender.sol`
- Node 20+ (the AVV extension is TypeScript; scaffold tooling uses Node too)
- cloudflared (for the ext-proxy public tunnel)
- gcc / build-essential (REQUIRED: cgo abigen fails to link without it)

A Coston2-funded key: get C2FLR from the Coston2 faucet for `INITIAL_OWNER`.

## 1. Clone the scaffold

```
git clone --depth 1 https://github.com/flare-foundation/fce-extension-scaffold.git
cd fce-extension-scaffold
```

## 2. Drop in the AVV extension

Copy this folder's `extension/*` into the scaffold's TypeScript app dir, and
replace the scaffold's `InstructionSender.sol`:

```
cp -r <this-folder>/extension/* typescript/src/app/
cp    <this-folder>/InstructionSender.sol contracts/InstructionSender.sol
```

`extension/` contains:
- `config.ts`  - adds `OP_TYPE_CURATION` = bytes32("CURATION") and
  `OP_COMMAND_CYCLE` = bytes32("CYCLE") next to the GREETING constants (KEEP the
  Hello World ones).
- `avv.ts`     - `PLAN_ABI`, `buildPlan(marketData, params)`, `encodePlan(plan)`.
- `handlers.ts` - adds `handleCurationCycle` + registers CURATION/CYCLE, and a
  separate `reportCurationState()`. `reportState()` is left byte-for-byte
  unchanged (the conformance fixtures pin it).
- `vendor/optimize.ts`   - verbatim AVV optimizer (pure TS, no network).
- `vendor/marketData.ts` - the bundled market snapshot (typed export).
- `__tests__/curation.test.ts` - unit tests for the handler + plan builder.

Note: these files are the FULL replacements for the scaffold's `config.ts` and
`handlers.ts` (they contain the Hello World code plus the AVV additions), so a
straight copy is correct.

Sanity-check locally before deploying:

```
cd typescript && npm install && npm run build && npx vitest run   # all tests pass
cd .. && forge build                                              # sendCuration compiles
```

## 3. Configure `.env.coston2`

Copy the template from `env/.env.coston2.example` to the scaffold root as
`.env.coston2` and fill it:

```
cp <this-folder>/env/.env.coston2.example .env.coston2
```

Set:
- `DEPLOYMENT_PRIVATE_KEY` - a Coston2-funded key
- `INITIAL_OWNER`          - the address derived from that key
- `PROXY_PRIVATE_KEY`      - a funded key for proxy signing
- `LANGUAGE=typescript`    - already set (the AVV handlers are TypeScript)
- `SIMULATED_TEE=true`     - simulated attestation (no real TEE hardware)

`full-setup.sh --chain coston2` copies `.env.coston2` to `.env` automatically.

## 4. Configure the ext-proxy DB (indexer creds)

Copy the proxy toml example and fill the `[db]` block with the Coston2 chain
indexer credentials:

```
cp <this-folder>/env/extension_proxy.coston2.docker.toml.example \
   config/proxy/extension_proxy.coston2.docker.toml
# edit [db] host/port/database/username/password
chmod 644 config/proxy/extension_proxy.coston2.docker.toml
```

The `chmod 644` is NOT optional. See GOTCHAS.

## 5. Run the full setup

```
./scripts/full-setup.sh --chain coston2 --tunnel --test
```

This runs pre-build -> start (docker compose: redis, ext-proxy, extension-tee)
-> post-build (deploys `InstructionSender`, calls `setExtensionId`, registers TEE
governance + machine) -> test. `--tunnel` starts the cloudflared quick tunnel
and syncs `EXT_PROXY_URL`. Wait for:

```
All tests passed
```

## 6. Prove the AVV handler in the enclave

Confirm the CURATION/CYCLE handler is wired and returns a Plan. Copy `probe.mjs`
into the extension-tee container and run it there (the extension server listens
on `EXTENSION_PORT`, default 8080, on the container's localhost):

```
EXT=$(docker ps --format '{{.Names}}' | grep extension-tee | head -1)
docker cp probe.mjs "$EXT":/tmp/probe.mjs
docker exec "$EXT" node /tmp/probe.mjs
```

Expected: `HTTP 200  status=1` and a decoded 3-venue Plan (venue 0 FXRP,
1 USDT0, 2 WFLR), each allocation <= the 30% cap, reserve >= the 20% floor, and
`sum(alloc)+reserve == totalOut`. `probe.mjs` sends an empty `originalMessage`
so the enclave uses its bundled snapshot; set `PROBE_MARKET_JSON=<file>` to feed
a live snapshot instead.

## 7. Wire the two values back into the frontend

After deploy, take:
- the deployed `InstructionSender` address on Coston2, and
- the public ext-proxy URL (the cloudflared `https://<slug>.trycloudflare.com`,
  no trailing slash),

and paste them into `demo-with-tee/src/tee.config.ts` as `INSTRUCTION_SENDER`
and `EXT_PROXY_URL`. `CURATION_OPTYPE` / `CURATION_OPCOMMAND` are already the
bytes32 of "CURATION" / "CYCLE" and match this extension. If the send reverts
with `FeeTooLow`, set `INSTRUCTION_FEE` to the registry's current required fee.

## GOTCHAS

- The proxy toml MUST be mode 644. If it is 600 the ext-proxy container cannot
  read it and crashes on start. Always `chmod 644
  config/proxy/extension_proxy.coston2.docker.toml`.
- cgo abigen needs gcc. Install build-essential/gcc or the Go binding generation
  step fails to link.
- The cloudflared quick-tunnel URL is EPHEMERAL: it changes on every restart. It
  is fine for a one-off test, but for a durable demo use a NAMED tunnel (or a VM
  with a stable hostname) via `TUNNEL_ARGS=run --token ...`, and update
  `EXT_PROXY_URL` + the frontend accordingly.
- Register only ONE TEE machine. Multiple active TEE machines make the ext-proxy
  route `/action/result` to a stale one, so polling 404s / times out. Pause any
  stale machines.
- `SIMULATED_TEE=true` uses a simulated (test) attestation: the code hash /
  platform are test values, not hardware-measured. For real attestation run on a
  GCP Confidential Space VM with `SIMULATED_TEE=false`.

## Gotcha: code changes need a full redeploy, not a container restart
The enclave key (teeID) rotates when the extension-tee container is recreated. Rebuilding the image + `docker compose up -d extension-tee` gives a NEW teeID that no longer matches the on-chain-registered TEE machine, and the proxy fails with `invalid teeID`. To change the extension code (e.g. swap in your model), re-run `./scripts/full-setup.sh --chain coston2 --tunnel --test` so the new enclave is re-registered.
