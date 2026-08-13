# RUN - two terminals

The Mystic allocation demo runs in **two terminals** (plus one optional). Nothing is
signed or broadcast; Mystic is Flare mainnet only, so this prepares and verifies the
position rather than executing it.

Prerequisites: node 20+, python3, and (for the optional fork test) foundry
(`curl -L https://foundry.paradigm.xyz | bash && foundryup`).

## Terminal 1 - prepare + verify everything

```bash
cd /path/to/this-repo    # the folder containing prepare.sh
bash prepare.sh
```

This runs, in order: the optimizer (optimal allocation over the live snapshot),
the prepared-transaction builder (6 unsigned Flare-mainnet txs, calldata verified),
the TEE model (signs the bounded plan and verifies the signature), and the contract
build. It installs JS deps on first run.

## Terminal 2 - the UI

```bash
cd /path/to/this-repo
bash ui.sh
```

Then open http://localhost:3000 for the six-step walkthrough (live market inputs and
graphs, the optimizer decision, the signed plan, on-chain cap validation incl. the
bad-plan rejection, and the prepared-but-not-broadcast transactions).

## Terminal 3 (optional) - live fork test of the contracts

```bash
cd /path/to/this-repo
bash forktest.sh
```

Deposits into the real Mystic Core vaults on a Flare-mainnet fork (read-only fork,
nothing broadcast). Slower, needs foundry + network.

---

Deeper reading: `ARCHITECTURE.md` (the full map), `optimizer/EQUATION.md` (the
allocation math), `prepared-txs/PREPARED_TX.md` (the exact calldata), `STATUS.md`
(what is real vs simulated).

The legacy Coston2 AVV walkthrough (docker + real-TEE stack, `up.sh` / `down.sh` /
`REAL_TEE.md`, `addresses.json`) is unchanged and still available; the Mystic
allocation flow above is the current single demo.
