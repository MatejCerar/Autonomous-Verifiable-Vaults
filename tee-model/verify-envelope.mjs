// Standalone verifier for a signed plan envelope.
//
// Reconstructs planHash byte-for-byte per schema/preimage.md (address, chainid,
// planId, modelVersion, codeHash, nonce, expiry, totalOut, reserveAmount,
// allocHash) using viem encodePacked, with allocHash = keccak256(encodeAbiParameters
// tuple[]), then recovers the EIP-191 signer and asserts it equals the expected
// TEE address. Also checks the on-chain "totals mismatch" invariant.
//
// Usage:
//   node verify-envelope.mjs <envelope.json> <controllerAddress> <chainId> <expectedSigner>
// Defaults: controller = zero address, chainId = 14 (matches the offline sample).
import {readFileSync} from 'node:fs'
import {
  encodeAbiParameters,
  encodePacked,
  keccak256,
  getAddress,
  recoverMessageAddress,
} from 'viem'

const file = process.argv[2] || 'sample-envelope.json'
const controller = getAddress(
  process.argv[3] || '0x0000000000000000000000000000000000000000',
)
const chainId = BigInt(process.argv[4] || '14')
const expectedSigner = process.argv[5]
  ? getAddress(process.argv[5])
  : null

const env = JSON.parse(readFileSync(file, 'utf8'))
const p = env.plan

// allocHash = keccak256(abi.encode(plan.allocations)) - abi.encode, NOT packed.
const allocHash = keccak256(
  encodeAbiParameters(
    [
      {
        type: 'tuple[]',
        components: [
          {name: 'venueId', type: 'uint256'},
          {name: 'amount', type: 'uint256'},
        ],
      },
    ],
    [p.allocations.map((a) => ({venueId: BigInt(a.venueId), amount: BigInt(a.amount)}))],
  ),
)

// planHash = keccak256(abi.encodePacked(controller, chainid, planId, modelVersion,
//   codeHash, nonce, expiry, totalOut, reserveAmount, allocHash))
const planHash = keccak256(
  encodePacked(
    [
      'address', 'uint256', 'bytes32', 'uint256', 'bytes32',
      'uint256', 'uint256', 'uint256', 'uint256', 'bytes32',
    ],
    [
      controller, chainId, p.planId, BigInt(p.modelVersion), p.codeHash,
      BigInt(p.nonce), BigInt(p.expiry), BigInt(p.totalOut),
      BigInt(p.reserveAmount), allocHash,
    ],
  ),
)

const recovered = getAddress(
  await recoverMessageAddress({message: {raw: planHash}, signature: env.signature}),
)

// totals-mismatch invariant: sum(allocations) + reserveAmount == totalOut.
const sumAlloc = p.allocations.reduce((s, a) => s + BigInt(a.amount), 0n)
const totalOut = BigInt(p.totalOut)
const reserve = BigInt(p.reserveAmount)
const totalsOk = sumAlloc + reserve === totalOut

console.log('file:          ', file)
console.log('controller:    ', controller)
console.log('chainId:       ', chainId.toString())
console.log('allocHash:     ', allocHash)
console.log('planHash:      ', planHash)
console.log('recovered:     ', recovered)
if (expectedSigner) {
  console.log('expectedSigner:', expectedSigner)
  console.log('signer match:  ', recovered === expectedSigner ? 'PASS' : 'FAIL')
}
console.log(
  'sum(alloc):    ', sumAlloc.toString(),
  '| reserve:', reserve.toString(),
  '| totalOut:', totalOut.toString(),
)
console.log('totals check:  ', totalsOk ? 'PASS (sum+reserve==totalOut)' : 'FAIL')

const ok = totalsOk && (!expectedSigner || recovered === expectedSigner)
if (!ok) process.exit(1)
console.log('VERIFY PASS')
