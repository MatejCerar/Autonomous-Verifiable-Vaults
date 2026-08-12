# Automated Curation (Autonomous Verifiable Vaults)

A wrapper that lets a vault curator run their allocation model **inside a TEE**
(Flare Confidential Compute) and have every rebalance **enforced on-chain**. The
curator's model stays private. Each cycle it reads its inputs, produces an
allocation plan, and signs that plan with a key that only exists inside the
enclave. An on-chain `CurationController` then verifies the signature and the
model's code fingerprint, checks the plan against the mandate (per-venue caps, a
reserve floor, a max-deployed cap, freshness, replay/nonce), and only then moves
funds. Anything outside the mandate reverts before a single token moves. The
result is autonomous rebalancing you can verify instead of trust.

This repository is a working proof of concept on **Flare Coston2** (testnet).
The security and verifiability are real: a real TEE signs, a real contract
enforces, on a real network, over a live oracle read. The vault, the ERC-20, the
two "lending venues", and the allocation model itself are deliberate
**placeholders** so any condition (high utilisation, low liquidity, a bad plan)
can be triggered on demand. The point is to prove the wrapper; a curator's real
vault, real markets, and real model plug into those same slots without changing
the enforcement layer. See `REAL_TEE.md` for what moving to production hardware
and real markets involves.

## Run it

You need **Docker** (Go and Foundry run inside containers) and a funded Coston2
private key. Node is only needed for the optional browser UI.

```bash
export PK=0x<your funded Coston2 key>
bash up.sh          # builds the TEE + model images, starts the TEE, deploys the
                    # AVV stack on Coston2 wired to that TEE, prints the addresses
```

Then start the UI in a terminal you keep open, and open http://127.0.0.1:3000:

```bash
cd frontend && npm install && npm run dev
```

Click **Run cycle**: the model reads its inputs, signs a plan inside the TEE, and
the contract executes it on Coston2 (the shown tx hash links to the block
explorer). Cycles are idempotent, so you can run it repeatedly. Click **Run bad
plan** to watch the contract reject an out-of-mandate plan on-chain. Tear the
whole stack down with `bash down.sh`.

## Layout

- `contracts/` - the enforcement layer (Foundry): `CurationController`,
  `MandateRegistry`, `AutomatedCurationVault` (ERC-4626), and the venue + reserve
  adapters.
- `tee-model/` - the allocation model + service that runs inside the TEE and
  signs plans.
- `frontend/` - the React UI (a six-step walkthrough of one cycle).
- `up.sh` / `down.sh` - bring the whole stack up / down (Docker only).
- `REAL_TEE.md` - how the simulated attestation here becomes real hardware
  attestation, and how the mocks become real vaults and markets.

## Security note

`up.sh` writes your key into `frontend/.env.local` so the browser can submit
transactions in the demo. That file, and the whole `TEE/` stack, are gitignored
and must never be committed. This is a testnet demo key; rotate it and never use
a mainnet key here.
# Autonomous-Verifiable-Vaults
