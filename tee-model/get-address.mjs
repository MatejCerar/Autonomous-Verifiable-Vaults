// Print the running TEE node's EVM signing address. Retries until the TEE sign
// server is ready. Recovers under EIP-191(keccak256(message)) (the /sign scheme).
// Env: TEE_SIGN_URL (default http://tee:7701/sign).
import { keccak256, toHex, recoverMessageAddress } from 'viem'
const url = process.env.TEE_SIGN_URL || 'http://tee:7701/sign'
const msg = new Uint8Array(32).fill(1)
const body = JSON.stringify({ message: Buffer.from(msg).toString('base64') })
for (let i = 0; i < 90; i++) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    if (r.ok) {
      let s = Buffer.from((await r.json()).signature, 'base64')
      if (s[64] < 27) s[64] += 27
      process.stdout.write(await recoverMessageAddress({ message: { raw: keccak256(msg) }, signature: toHex(s) }))
      process.exit(0)
    }
  } catch { /* not ready */ }
  await new Promise((res) => setTimeout(res, 1000))
}
process.stderr.write('TEE sign server not ready after 90s\n')
process.exit(1)
