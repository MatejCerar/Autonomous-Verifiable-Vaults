# Signed Rejection Proof

"Verify, don't trust." This proof produces a genuinely-signed transaction that
carries a valid, bounded, enclave-signed allocation `Plan`, and shows that a
deployed `CurationController` REJECTS it on-chain with `"bad signer"` because the
enclave that signed the plan is NOT the one registered in the mandate. No funds
move.

## What it proves

A plan can be perfectly in-mandate:

- all three venue allocations under the 30% per-venue cap,
- reserve at or above the 20% floor,
- a valid current nonce (`controller.nonce()`),
- a future expiry,
- carrying the mandate's REGISTERED `codeHash` (so the fingerprint check passes),

and STILL be rejected, because it was signed by the WRONG enclave key.

## Why it reverts with `"bad signer"`

The controller runs its checks in a fixed order (see `../schema/preimage.md`):

1. `replay` - planId already used
2. `bad nonce` - nonce != controller.nonce()
3. `expired` - expiry <= block.timestamp
4. `bad fingerprint` - codeHash not enabled for the model version
5. **`bad signer`** - recovered signer != `registry.teeAddress()`
6. cap checks (`reserve floor`, `over total cap`, `over venue cap`, `totals mismatch`)

The rogue plan is built to pass checks 1-4 and every cap check, so the ONLY
thing wrong is the signing key. It therefore reverts precisely at check 5,
`"bad signer"`. Every reject reverts BEFORE any `adapter.allocate`, so no funds
move.

## The honesty note (two signers, two roles)

- The **rogue enclave key** signs the **plan** (EIP-191 personal_sign over the
  raw 32-byte planHash, per preimage.md). This is the wrong enclave: its plans
  are rejected on-chain.
- A **funded EOA** (env `PK`) signs the **transaction** and pays gas. It does
  NOT sign the plan.

So this is a real, broadcastable, self-reverting transaction. The transaction is
genuinely signed and mined; it simply reverts. Nothing moves.

## Files

- `../contracts/test/RejectUnauthorizedTee.t.sol` - in-process proof (Foundry).
  Deploys the full stack, registers the authorized enclave as the TEE signer,
  builds a valid bounded plan, signs it with a ROGUE key, and asserts
  `executePlan` reverts with `"bad signer"` and that no funds moved (vault
  balances, venue positions, reserve, and nonce all unchanged). A positive
  control signs the SAME plan bytes with the authorized key and executes
  successfully, proving the signer is the only difference.
- `prove-rejection.mjs` - viem/Node script for the real Coston2 broadcast.
- `prove-rejection.sh` - thin wrapper (env-only secrets).
- `rejection-tx.signed.json` - written by the script: the raw signed tx hex plus
  the decoded revert reason (the artifact; produced without requiring broadcast).

## Run it on Coston2

### 1. Stand up the stack (writes `../addresses.json`)

```
PK=<funded_coston2_eoa_key> scripts/deploy-testnet.sh
```

This registers the simulated TEE signer (the authorized enclave) and the model
`codeHash` in the mandate.

### 2. Prove the rejection

Simulate only (eth_call) and write the signed-tx artifact, no broadcast:

```
PK=<funded_coston2_eoa_key> scripts/prove-rejection.sh
```

Actually mine the reverted transaction:

```
BROADCAST=1 PK=<funded_coston2_eoa_key> scripts/prove-rejection.sh
```

Optional env:

- `RPC` - RPC override (default Coston2 `https://coston2-api.flare.network/ext/C/rpc`)
- `ROGUE_PK` - the rogue enclave key that signs the plan. If unset, a fresh
  throwaway key is generated and its address printed.

## Expected outcome

- eth_call prints: `bad signer` -> `confirmed: "bad signer" (wrong enclave)`.
- With `BROADCAST=1`, the transaction is MINED with on-chain status = 0
  (reverted), and the script prints the tx hash plus an explorer link:
  `https://coston2.testnet.flarescan.com/tx/<hash>`.
- Vault balances, venue positions, reserve, and the controller nonce are all
  unchanged. No funds moved.

## Verified locally

The end-to-end tooling was verified against a local anvil at chainId 114 (the
same chain id as Coston2):

- `forge test --match-contract RejectUnauthorizedTee -vvv` passes (3 tests: the
  rogue-signer rejection, the positive control, and a reject-then-accept on the
  identical plan preimage).
- Deploying via `DeployTestnet.s.sol` to anvil, then running the broadcast path,
  produced a mined transaction with status `reverted` and a decoded revert
  reason of exactly `bad signer` (confirmed independently with
  `cast call` -> `execution reverted: bad signer`).
