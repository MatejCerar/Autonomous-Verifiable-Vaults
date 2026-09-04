# Running the AVV extension on the real Coston2 FCC

This is the real Flare Confidential Compute pipeline: `sendCuration` on-chain -> a
registered tee-node picks it up -> the enclave computes + signs the plan in the
TEE -> the ext-proxy serves the signed result -> the frontend enforces it via
`CurationController.executePlan`. No gateway shim.

This is the ONLY path that runs the model inside a real TEE (attestation). The
gateway demo (`docker-compose.enclave.yml`) runs straight from this repo with no
scaffold and no database; use this doc only when you want the real on-chain FCC
tee-node.

Scaffold upstream (Flare's, cloned by the script below):
https://github.com/flare-foundation/fce-extension-scaffold

## Quick setup (one command)

From the repo root:

```
./setup-scaffold.sh
```

It clones the scaffold, applies the four version patches below, copies the AVV
extension in, and drops the config templates. Then you fill two secrets and the
`[db]` block (see Setup) and run `./scripts/full-setup.sh` inside the scaffold.
Override the clone location with `SCAFFOLD_DIR=/path ./setup-scaffold.sh`. The rest
of this doc explains what the script does, and the manual steps if you prefer.

## The one thing that made it work: match Coston2's versions

`coston2-1` runs `tee-node v0.0.24-dev` + `tee-proxy v0.0.21-dev`. The scaffold
ships pinned to tee-proxy `v0.0.18`, and a mismatched proxy makes the FTDC
availability check reject the attestation (the registration failure we hit).
tee-node was already `v0.0.24`, so only tee-proxy needed bumping.

### Forward-port the scaffold from v0.0.18 to v0.0.21 (four edits)

1. `proxy/Dockerfile`: `ARG TEE_PROXY_VERSION=v0.0.18` -> `v0.0.21`.
2. `proxy/Dockerfile`: builder base `FROM golang:1.25.1-alpine` -> `golang:1.26-alpine`
   (tee-proxy v0.0.21's `go.mod` requires Go >= 1.25.8).
3. `proxy/Dockerfile`: the config example moved in v0.0.21, so
   `COPY --from=builder /app/tee-proxy/config.example.toml ...` becomes
   `COPY --from=builder /app/tee-proxy/config/config.example.toml ./config/config.toml`.
4. `tools/go.mod`: `go get github.com/flare-foundation/tee-proxy@v0.0.21 && go mod tidy`.

Then `bash scripts/check-versions.sh` should print "all version pins consistent".

## Setup

- Copy `extension/*` into the scaffold's `typescript/src/app/`, move
  `__tests__/curation.test.ts` to `typescript/src/__tests__/`, and copy
  `InstructionSender.sol` into `contracts/`.
- `.env.coston2`: `LANGUAGE=typescript`, a funded Coston2 key for
  `DEPLOYMENT_PRIVATE_KEY`/`PROXY_PRIVATE_KEY`, `INITIAL_OWNER`, `SIMULATED_TEE=true`,
  `NORMAL_PROXY_URL=https://tee-proxy-coston2-1.flare.rocks`, plus the AVV signing
  vars: `TEE_PLAN_SIGNER_KEY` (its address is `MandateRegistry.teeAddress`),
  `AVV_CONTROLLER`, `AVV_CHAIN_ID=114`, `AVV_CODE_HASH`, `AVV_MODEL_VERSION=1`.
- `config/proxy/extension_proxy.coston2.docker.toml`: fill the `[db]` block, and
  ONLY here (not in `.env`, and this file is not committed to this repo, we ship
  only the template at `tee-extension/env/*.example`). The tee-proxy reads the
  Coston2 indexer database through it. You need five values:
  ```toml
  [db]
  host     = "<from Flare>"      # Coston2 indexer DB host
  port     = 3306
  database = "<from Flare>"      # indexer DB name
  username = "<from Flare>"      # your Flare-provided indexer user
  password = "<from Flare>"
  ```
  Where to GET them: from Flare (the shared Coston2 indexer). They are secrets, so
  keep them out of any repo. `chmod 644` the file after filling it.
- `docker-compose.coston2.yaml`: pass the `AVV_*` + `TEE_PLAN_SIGNER_KEY` env into the
  `extension-tee` service.

## Deploy + verify

```
./scripts/full-setup.sh --chain coston2 --tunnel --test
```

Expect: `availability check proof obtained` -> `Registered TEE node with id 0x...`
-> `SAY_HELLO/SAY_GOODBYE ... Test passed` -> `Full setup complete`. Note the
printed InstructionSender address and the ext-proxy tunnel URL, and put them in
`src/tee.config.ts` as `INSTRUCTION_SENDER` and `EXT_PROXY_URL`. The frontend then
prefers this on-chain FCC path over the gateway.

## Traps (from the scaffold docs, and the team Slack)

- Every container/VM relaunch mints a new `teeId`; the old one lingers on-chain and
  swallows half the routed instructions (they hang). Re-run `full-setup` cleanly and
  do not leave stale machines registered.
- Any rebuild changes the attested code-hash, so re-whitelist + re-register.
- `setExtensionId()` is one-shot (zero-only, no reset).
- Keep matching whatever version `coston2-1` runs; a newer tee-node/tee-proxy than
  Coston2 expects will not register.

## Keep it running on a server (durable demo)

A cloudflared quick tunnel and a fresh container each run are what make a bring-up
ephemeral. To keep one node live on your own server so anyone can just open the
frontend and click:

1. Stable URL: use a NAMED cloudflared tunnel (`cloudflared tunnel create avv` +
   a `config.yml` route) or a reverse proxy on your own domain, not a quick
   tunnel. The ext-proxy URL then survives restarts.
2. Restart policy: run the stack with `docker compose up -d` and
   `restart: unless-stopped` on the services (or a systemd unit), so it comes back
   after a reboot.
3. Set once: put the printed `InstructionSender` address and the stable ext-proxy
   URL into `src/tee.config.ts` (`INSTRUCTION_SENDER` + `EXT_PROXY_URL`) and commit.
   The deployed frontend then needs no per-visitor setup.

The trap to respect for a long-lived node: every container/VM relaunch mints a NEW
`teeId`, and the old one lingers on-chain and swallows half the routed
instructions (they hang). So do NOT restart the tee-node casually. Bring it up
once and leave it up; only re-run `full-setup` when you actually change the
extension code (which changes the code hash and needs a re-whitelist + re-register
anyway).

For a persistent node whose attestation is also real hardware, run this same stack
on a GCP Confidential Space VM with `SIMULATED_TEE=false` / `MODE=0`. Everything
else (the URL + restart guidance above) is identical.
