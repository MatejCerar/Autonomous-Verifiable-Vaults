# Architecture

The real-TEE AVV system has three layers: the enclave (the model), the frontend
(the driver), and the on-chain enforcement backend (the verifier and custody).
The signed `PlanLib.Plan` is the single artifact that crosses all three. Its
format is frozen in `schema/preimage.md`.

## Cycle data flow

```
 Frontend (src/, React + Vite + viem)
   |
   |  1. read CurationController.nonce()                 [Coston2 read]
   |  2. read live FTSO prices                           [Coston2 read]
   |  3. build market snapshot, send {snapshot, nonce}
   v
 Enclave (tee-extension/, fce-extension-scaffold tee-node)   RUNS INSIDE THE TEE
   |
   |  handlers.ts::handleCurationCycle
   |    -> avv.ts::buildPlan
   |         -> vendor/optimize.ts   (pure optimizer, no network)
   |    -> EIP-191 sign the plan preimage with the enclave-held key
   |  returns abi.encode(Plan, signature)
   v
 Frontend
   |  4. decode (plan, signature)
   |  5. CurationController.executePlan(plan, signature)  [Coston2 write]
   v
 Enforcement backend (contracts/)
   |  8 ordered checks (replay, nonce, expiry, fingerprint,
   |  TEE signature, mandate caps vs TVL, totals identity), then:
   |    AutomatedCurationVault.pullForCuration(totalOut)
   |    VenueAdapter.allocate(...)  x per allocation
   |    ReserveAdapter.park(reserveAmount)
   |    vault.reconcile()
   v
 Funds moved on-chain. PlanExecuted / Allocated / Reserved events emitted.
```

## The signed plan (the integration contract)

`PlanLib.Plan` carries: `planId`, `modelVersion`, `codeHash`, `nonce`, `expiry`,
`totalOut`, `reserveAmount`, and `allocations[] {venueId, amount}`.

The signed preimage is domain-separated on the CurationController address and the
chain id:

```
allocHash = keccak256(abi.encode(allocations))            // abi.encode for the dynamic array
planHash  = keccak256(abi.encodePacked(
              controller, chainId, planId, modelVersion, codeHash,
              nonce, expiry, totalOut, reserveAmount, allocHash))
ethHash   = keccak256("\x19Ethereum Signed Message:\n32" || planHash)
signer    = ecrecover(ethHash, sig)   // must == MandateRegistry.teeAddress()
```

The enclave computes this hash and signs it in `avv.ts::computePlanHash` /
`signPlan`; the contract recovers and checks it in `CurationController.executePlan`
via `PlanLib.hashPlan` / `PlanLib.recoverSigner`. Both sides are byte-for-byte
the frozen spec in `schema/preimage.md`.

## Trust boundary

The enclave is the only component that holds the plan-signer key. Its address is
written once into `MandateRegistry.teeAddress`. The on-chain verifier trusts a
plan only if:

- it is EIP-191-signed by that `teeAddress`, and
- its `(modelVersion, codeHash)` is an enabled fingerprint in MandateRegistry.

So the chain does not trust the frontend or the relayer: they can relay a plan
but cannot forge or alter one. Any tampering breaks the signature or the totals
identity and the transaction reverts before any funds move.

What the chain does NOT verify in this demo is the hardware attestation behind
that key. The enclave runs with `SIMULATED_TEE=true`, so the `codeHash`
fingerprint is self-measured rather than hardware-attested. On production
hardware the same `teeAddress` binding is backed by a real attestation; the
on-chain checks are unchanged.

## Component map

| Layer | Path | Role |
| --- | --- | --- |
| Model | `tee-extension/extension/vendor/optimize.ts` | pure allocation optimizer |
| Model | `tee-extension/extension/avv.ts` | buildPlan, plan hash, sign |
| Model | `tee-extension/extension/handlers.ts` | enclave CURATION/CYCLE handler |
| Entry | `tee-extension/InstructionSender.sol` | on-chain instruction entry point |
| Driver | `src/` | dashboard: nonce, snapshot, decode, executePlan |
| Verifier | `contracts/src/CurationController.sol` | 8 checks + routing |
| Mandate | `contracts/src/MandateRegistry.sol` | teeAddress, fingerprints, caps |
| Custody | `contracts/src/AutomatedCurationVault.sol` | ERC-4626 vault |
| Routing | `contracts/src/adapters/*` | VenueAdapter, ReserveAdapter |
| Venues | `contracts/src/mocks/MockLendingVenue.sol` | mock ERC-4626 (Mystic stand-in) |
| Spec | `schema/preimage.md` | frozen signed-plan preimage |
