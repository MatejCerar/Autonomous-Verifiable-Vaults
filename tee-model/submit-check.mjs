// Fetch a TEE-signed plan from the running model service and submit executePlan
// on Coston2 - the exact path the frontend "Run cycle" button uses. Env: PK.
import { createWalletClient, createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'node:fs'
const RPC = process.env.RPC_URL || 'https://coston2-api.flare.network/ext/C/rpc'
const MODEL = process.env.MODEL_URL || 'http://model:8080'
const A = JSON.parse(readFileSync('/addresses.json', 'utf8'))
const abi = [
  { type: 'function', name: 'nonce', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'executePlan', stateMutability: 'nonpayable',
    inputs: [
      { name: 'plan', type: 'tuple', components: [
        { name: 'planId', type: 'bytes32' }, { name: 'modelVersion', type: 'uint256' },
        { name: 'codeHash', type: 'bytes32' }, { name: 'nonce', type: 'uint256' },
        { name: 'expiry', type: 'uint256' }, { name: 'totalOut', type: 'uint256' },
        { name: 'reserveAmount', type: 'uint256' },
        { name: 'allocations', type: 'tuple[]', components: [
          { name: 'venueId', type: 'uint256' }, { name: 'amount', type: 'uint256' }] } ] },
      { name: 'signature', type: 'bytes' } ], outputs: [] },
]
const chain = { id: 114, name: 'coston2', nativeCurrency: { name: 'C2FLR', symbol: 'C2FLR', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }
const acct = privateKeyToAccount(process.env.PK)
const pub = createPublicClient({ chain, transport: http(RPC) })
const wal = createWalletClient({ account: acct, chain, transport: http(RPC) })
const ctrl = A.deployed.curationController
const e = await (await fetch(`${MODEL}/cycle`)).json()
const p = e.plan
const plan = { planId: p.planId, modelVersion: BigInt(p.modelVersion), codeHash: p.codeHash, nonce: BigInt(p.nonce), expiry: BigInt(p.expiry), totalOut: BigInt(p.totalOut), reserveAmount: BigInt(p.reserveAmount), allocations: p.allocations.map(a => ({ venueId: BigInt(a.venueId), amount: BigInt(a.amount) })) }
console.log('controller', ctrl, 'nonce', (await pub.readContract({ address: ctrl, abi, functionName: 'nonce' })).toString())
const h = await wal.writeContract({ address: ctrl, abi, functionName: 'executePlan', args: [plan, e.signature] })
const r = await pub.waitForTransactionReceipt({ hash: h })
console.log('tx', h, '| STATUS', r.status, '| block', r.blockNumber.toString())
console.log('nonce after', (await pub.readContract({ address: ctrl, abi, functionName: 'nonce' })).toString())
