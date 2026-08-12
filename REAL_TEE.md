# Using the real FCC TEE (Coston2) instead of the simulated signer

The demo currently signs plans with a simulated TEE key. FCC is live on Coston2, so the
signer can be swapped for a real FCC extension. This is the path, honestly scoped.

## FCC is live on Coston2 (chainId 114)
- `FlareTeeManager` (Diamond) `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE` - extensions, machine
  registration, instructions, verification, wallets (PMW), VRF (via facets).
- FDC-V2: `Fdc2Hub` `0x04dd3Ba33aC798d400bEc42A26F82f9812A421dc`, `Fdc2Verification`
  `0xA34Ff9be42b2C7782786270a51d33b1baC0462Cd`.
- `TeePayments` `0x86CB3e2dA1a4Ec30e2Ff2E5bA1A2D5ff9C9D44f4`.
- Not in FlareContractRegistry yet; addresses come from the scaffold's
  `config/coston2/deployed-addresses.json`. (STP.13 targets Songbird for the enshrined launch.)
Guide: https://dev.flare.network/fcc/guides/sign-extension

## Honest reality
Even the official guide runs a **local simulated TEE** (Docker) against Coston2. Real hardware
attestation requires hosting the `tee-node` on GCP Confidential Space. So "real TEE" as a dev =
run the tee-node/ext-proxy/redis stack, register on the live `FlareTeeManager`, verify via its
`VerificationFacet`. The attestation stays dev-simulated until it runs on GCP Confidential Space.

## Prerequisites you must obtain (external, not in this repo)
1. C-chain indexer DB credentials - request from Flare (support or X). The guide is explicit.
2. An ngrok authtoken (so on-chain instruction events reach your local TEE proxy).
3. Docker. A Coston2 key funded with C2FLR (already have one).

## Steps (per the guide, using the FCC extension scaffold/tee-node)
1. Clone the FCC extension scaffold; put our model logic in the extension's `processAction`
   (it already produces the bounded plan; here it becomes the enclave's signed output).
2. `./scripts/use-chain.sh local coston2 go`; fill `.env.local.coston2` (key, indexer creds).
3. `ngrok http 6674` for the tunnel.
4. `./scripts/pre-build.sh` (deploy the extension's InstructionSender), `./scripts/start-services.sh`
   (tee-node + ext-proxy + redis via Docker), `./scripts/post-build.sh` (register the TEE machine +
   allow the code version on `FlareTeeManager`), `./scripts/test.sh` (send an instruction, get the
   attested signed result).

## What changes in our contracts to go fully real
Today `CurationController` verifies the plan signature against our own `MandateRegistry`
(`teeAddress` + allowed codeHash). To use real FCC:
- Register the model as an FCC extension + machine on `FlareTeeManager` (gets a real code-hash /
  machine identity and an attested signing key).
- Point `CurationController`'s verification at the real `FlareTeeManager` `VerificationFacet`
  (or verify the recovered signer is the registered machine key) instead of our `MandateRegistry`.
- Keep the plan preimage and all the hard-limit checks exactly as they are.
This is a wiring change to the verification source; the enforcement, vault, adapters, and the
plan format are unchanged. It cannot be end-to-end tested without the running TEE stack + the
indexer credentials above.

## Bottom line
FCC is real and live on Coston2. The demo can be upgraded from simulated signer to real FCC
extension by running the tee-node Docker stack and registering it on `FlareTeeManager` - gated
only on Flare-provided indexer credentials and an ngrok token, plus GCP Confidential Space for
true hardware attestation.

## Verified in this environment (2026-08-11) - against the real tee-node source under TEE/
The real Flare TEE stack you dropped in (`TEE/tee-node`, `TEE/tee-proxy`, `TEE/e2e`,
`TEE/extensions-example/dvn-extension`) was inspected and exercised:
- The real `tee-node` **compiles here**: `go build ./...` = exit 0 (Go 1.26.3 + gcc/cgo). It is
  the genuine node (go module `github.com/flare-foundation/tee-node`).
- Its **own signing tests pass here**: `go test ./pkg/wallets/...` = ok (EVM/XRPL secp256k1
  signing, key management, VRF). That is the exact crypto the enclave uses to sign a plan.
- The `dvn-extension/.env` is already wired for REAL Coston2 (`LOCAL_MODE=false`,
  `CHAIN_URL=coston2`), your key, Flare's hosted normal proxy
  (`tee-proxy-coston2-1.flare.rocks`), and a TEE EVM address (`0x743A5e89...`) - i.e. you have
  already run the node once and read its address from `/info`.

## What is NOT done here, and why (needs your machine)
The full live round-trip (on-chain instruction -> proxy -> TEE signs -> verify) was NOT run in
this sandbox because it needs long-lived servers (this sandbox kills them; use detached Docker),
plus:
- a C-chain **indexer DB for Coston2** feeding the ext-proxy (`config/proxy/extension_proxy.coston2.toml`
  expects MySQL at localhost:3306; run `flare-system-c-chain-indexer` against Coston2, or use the
  `e2e/` local sim which needs the manually-built `local/flare-smart-contracts-v2` (tee branch) image),
- an **ngrok tunnel** (`ngrok http 6674`) so the on-chain flow reaches your ext-proxy (the `.env`
  `EXT_PROXY_URL` is still a `PLACEHOLDER.ngrok-free.app`),
- and GCP Confidential Space for *hardware* attestation (dev mode uses `MODE=1` simulated).

## Finish the real run on your machine
From `TEE/extensions-example/dvn-extension`:
1. Fill `EXT_PROXY_URL` in `.env` with your `ngrok http 6674` URL.
2. Ensure a Coston2 indexer DB is reachable (own indexer, or Flare-provided creds).
3. `./scripts/full-setup.sh --test` - runs pre-build (deploy + register extension on the live
   `FlareTeeManager` with your key), starts the TEE node + ext-proxy, post-build (allow version +
   register machine), then `test.sh` sends an instruction and verifies the TEE-signed result.
4. To point the AVV demo at this: register the AVV model as the extension's `processAction`, and
   change `CurationController` to verify the plan signature against the registered TEE machine key
   (from `FlareTeeManager`) instead of our stand-in `MandateRegistry`.

## Security note
`TEE/extensions-example/dvn-extension/.env` contains your private key and a Sepolia Alchemy key in
plaintext. Do not commit it; rotate the key.
