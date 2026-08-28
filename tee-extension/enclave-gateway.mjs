// Enclave gateway: a thin CORS-enabled HTTP shim in front of the real Flare TEE
// extension server. The browser cannot POST cross-origin to the enclave's raw
// /action endpoint, and the on-chain FCC instruction transport (sendCuration ->
// tee-proxy) depends on a shared testnet attestation service that is flaky. This
// gateway forwards {market, nonce} straight to the real enclave, which computes
// AND signs the plan inside the TEE, and returns abi.encode(Plan, signature).
//
// The enclave is still doing the real work (compute + EIP-191 sign with the key
// whose address is the registered MandateRegistry.teeAddress). This only skips
// the on-chain message bus. No emojis, no em dashes.
import http from "node:http";

const ENCLAVE = process.env.ENCLAVE_URL || "http://172.19.0.4:7702";
const PORT = Number(process.env.GATEWAY_PORT || 8799);

function bytes32(s) {
  const e = new TextEncoder().encode(s);
  const b = new Uint8Array(32);
  b.set(e);
  return "0x" + Buffer.from(b).toString("hex");
}
function utf8hex(s) {
  return "0x" + Buffer.from(s, "utf-8").toString("hex");
}
const OP_TYPE = bytes32("CURATION");
const OP_CMD = bytes32("CYCLE");
const ID1 = "0x" + "00".repeat(31) + "01";

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST") { res.writeHead(404); res.end("POST /curation"); return; }

  let body = "";
  for await (const c of req) body += c;

  let originalMessage = "0x";
  try {
    const j = body ? JSON.parse(body) : {};
    if (j.market != null || j.nonce != null) {
      originalMessage = utf8hex(JSON.stringify({ market: j.market, nonce: j.nonce }));
    }
  } catch { /* empty -> bundled snapshot */ }

  const dataFixed = { instructionId: ID1, opType: OP_TYPE, opCommand: OP_CMD, originalMessage };
  const action = {
    data: { id: ID1, type: "instruction", submissionTag: "submit", message: utf8hex(JSON.stringify(dataFixed)) },
  };

  try {
    const r = await fetch(`${ENCLAVE}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    });
    const jr = await r.json();
    const raw = jr.result ?? jr;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: raw.status, data: raw.data, log: raw.log ?? null }));
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(e) }));
  }
});

server.listen(PORT, () => console.log(`enclave-gateway on :${PORT} -> ${ENCLAVE}`));
