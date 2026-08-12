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

## Live knobs (interactive demo, no code changes)

The venue conditions and the mandate limits are adjustable on-chain, and the
model reads both fresh every cycle. So you can change a knob between cycles and
watch the system react. Run these from the demo folder with your deployer key
exported (it is the venue operator and the registry owner). After each knob,
click **Run cycle** and watch Step 1 (inputs) and Step 3 (plan) change.

```bash
cd   # your demo folder
export PK=0x<your deployer key>
RPC=https://coston2-api.flare.network/ext/C/rpc
V0=$(jq -r '.deployed.mockVenues[0]'   addresses.json)
MR=$(jq -r '.deployed.mandateRegistry' addresses.json)
knob(){ docker run --rm -e PK --entrypoint sh ghcr.io/foundry-rs/foundry:latest -c "cast send $1 '$2' $3 --rpc-url $RPC --private-key \$PK"; }
```

**Demo A - the model adapts to market conditions.** Saturate venue 0 above the
90% utilisation limit and the model routes away from it:

```bash
knob $V0 'setUtilisationBips(uint256)' 9500
# Run cycle -> venue 0 shows "utilisation over max"; allocation shifts to venue 1 + reserve
knob $V0 'setUtilisationBips(uint256)' 4000     # reset -> venue 0 comes back next cycle
```

**Demo B - the chain enforces even against its own model.** Tighten venue 0's
on-chain cap to 10%, below the model's 25% target, and the contract rejects the
model's own signed plan:

```bash
knob $MR 'setVenueCapBips(uint256,uint256)' '0 1000'
# Run cycle -> the model still signs 25% for venue 0, and the contract REVERTS "over venue cap"
knob $MR 'setVenueCapBips(uint256,uint256)' '0 3000'   # reset cap to 30%
```

Demo B is the point that lands with a curation firm: the guarantee is
independent of the model. Even if the curator's model is buggy or compromised
and tries to breach the mandate, the chain rejects it. Tighten the cap live and
the model's own plan bounces. Together with the **Run bad plan** button and the
explorer link, that is a complete story.

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

## What are venue 0 and venue 1?

A "venue" is a place the vault can deploy capital to earn yield, for example a
lending market. This demo has two of them, venue 0 and venue 1, so the model has
a real allocation decision to make (how much to put in each, and how much to keep
in reserve) and so you can see it react when the two behave differently. In this
proof of concept both are `MockLendingVenue` contracts: they stand in for real
markets and expose knobs (utilisation, available liquidity, depeg) that let us
simulate any market condition on demand. In production these slots would point at
real lending markets, and the model, the mandate, and the enforcement layer stay
exactly the same.

