# FROZEN: signed-plan preimage (the integration contract)

Every component must reproduce this byte-for-byte. Changes require lead sign-off.
This mirrors `fce-orderbook/contracts/InstructionSender.sol` (ECDSA + EIP-191 recover to a
write-once TEE address), hardened with domain separation (controller address + chainid).

## Plan struct (Solidity)
```solidity
struct Allocation { uint256 venueId; uint256 amount; }
struct Plan {
    bytes32 planId;        // unique per cycle, replay-guarded on-chain
    uint256 modelVersion;  // must match an enabled version in MandateRegistry
    bytes32 codeHash;      // model fingerprint, must be enabled for modelVersion
    uint256 nonce;         // must equal controller.nonce(), then increments
    uint256 expiry;        // unix seconds, must be > block.timestamp
    uint256 totalOut;      // total pulled from vault this cycle (sum of allocations + reserveAmount)
    uint256 reserveAmount; // routed to ReserveAdapter (defensive sink)
    Allocation[] allocations;
}
```

## Hash (authoritative)
```solidity
bytes32 allocHash = keccak256(abi.encode(plan.allocations)); // abi.encode (NOT packed) for the dynamic array
bytes32 planHash = keccak256(abi.encodePacked(
    address(this),          // CurationController address (domain separation)
    block.chainid,          // uint256 (domain separation)
    plan.planId,            // bytes32
    plan.modelVersion,      // uint256
    plan.codeHash,          // bytes32
    plan.nonce,             // uint256
    plan.expiry,            // uint256
    plan.totalOut,          // uint256
    plan.reserveAmount,     // uint256
    allocHash               // bytes32
));
bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", planHash));
address signer = ecrecover(ethHash, v, r, s); // must == MandateRegistry.teeAddress()
```
Note: `abi.encodePacked` here is unambiguous because every field is fixed-width (address=20B,
uint256=32B, bytes32=32B). The only dynamic part (allocations) is pre-hashed with `abi.encode`.

## Off-chain signer (viem, TypeScript) - must match exactly
```ts
import { encodeAbiParameters, encodePacked, keccak256 } from 'viem'
const allocHash = keccak256(encodeAbiParameters(
  [{ type: 'tuple[]', components: [{ name: 'venueId', type: 'uint256' }, { name: 'amount', type: 'uint256' }] }],
  [plan.allocations],
))
const planHash = keccak256(encodePacked(
  ['address','uint256','bytes32','uint256','bytes32','uint256','uint256','uint256','uint256','bytes32'],
  [controller, BigInt(chainId), plan.planId, BigInt(plan.modelVersion), plan.codeHash,
   BigInt(plan.nonce), BigInt(plan.expiry), BigInt(plan.totalOut), BigInt(plan.reserveAmount), allocHash],
))
// EIP-191 personal_sign over the raw 32-byte planHash:
const signature = await account.signMessage({ message: { raw: planHash } })
```

## codeHash (model fingerprint)
`codeHash = keccak256(<bytes of the compiled model module>)`. Self-measured by the model service at
startup and printed; the deploy script enables it in MandateRegistry via `allowVersion(version, codeHash, platform)`.
This is the one value whose hardware attestation is SIMULATED here (see README). Everything else is real.

## On-chain reject order (each a distinct revert string for the UI)
1. `"replay"`        planId already used
2. `"bad nonce"`     nonce != controller.nonce()
3. `"expired"`       expiry <= block.timestamp
4. `"bad fingerprint"` !registry.isVersionSupported(modelVersion, codeHash)
5. `"bad signer"`    recovered != registry.teeAddress()
6. `"reserve floor"` reserveAmount < minReserveBips of post-plan TVL
   `"over total cap"` totalOut > maxTotalOutBips of TVL
   `"over venue cap"` any allocation.amount > venueCapBips of TVL
   `"totals mismatch"` sum(allocations)+reserveAmount != totalOut
Any reject reverts BEFORE any adapter.allocate, so no funds move.
