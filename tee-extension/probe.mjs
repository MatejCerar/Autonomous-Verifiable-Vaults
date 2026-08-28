// Direct CURATION/CYCLE prober for the AVV TEE extension.
//
// Builds a minimal POST /action request (the ActionData.message is hex-encoded
// UTF-8 JSON of a DataFixed with opType=bytes32("CURATION"),
// opCommand=bytes32("CYCLE") and an empty originalMessage so the enclave uses
// its bundled snapshot), sends it straight to the extension server, and decodes
// the returned PlanLib.Plan tuple so you can see the AVV allocation.
//
// Run it INSIDE the extension-tee container (the extension listens on
// EXTENSION_PORT, default 8080, on the container's localhost):
//   docker exec <extension-tee container> node /tmp/probe.mjs
// First copy this file in:
//   docker cp probe.mjs <extension-tee container>:/tmp/probe.mjs
//
// Optional env:
//   EXTENSION_PORT (default 8080), PROBE_HOST (default 127.0.0.1)
//   PROBE_MARKET_JSON (path to a market snapshot; default = empty -> bundled)
//
// This talks to the extension server directly, NOT the ext-proxy /action/result
// path the frontend uses. It needs no signatures because the extension server
// itself does not verify them (the proxy/tee-node layer does). It is purely a
// "is the AVV handler wired and returning a Plan" check.
//
// No emojis, no em dashes (house style).

import { readFileSync } from "node:fs";

const HOST = process.env.PROBE_HOST ?? "127.0.0.1";
const PORT = process.env.EXTENSION_PORT ?? "8080";
const URL = `http://${HOST}:${PORT}/action`;

// --- bytes32 helpers (UTF-8, right zero-padded to 32 bytes) ---
function stringToBytes32Hex(s) {
  const enc = new TextEncoder().encode(s);
  if (enc.length > 32) throw new Error(`too long for bytes32: ${s}`);
  const b = new Uint8Array(32);
  b.set(enc);
  return "0x" + Buffer.from(b).toString("hex");
}
function utf8ToHex(s) {
  return "0x" + Buffer.from(s, "utf-8").toString("hex");
}

const OP_TYPE_CURATION = stringToBytes32Hex("CURATION");
const OP_COMMAND_CYCLE = stringToBytes32Hex("CYCLE");
// 0x4355524154494f4e00... / 0x4359434c4500...

// originalMessage: empty ("0x") -> enclave uses its bundled snapshot, OR a
// hex-encoded UTF-8 JSON market snapshot from PROBE_MARKET_JSON.
let originalMessage = "0x";
if (process.env.PROBE_MARKET_JSON) {
  originalMessage = utf8ToHex(readFileSync(process.env.PROBE_MARKET_JSON, "utf-8"));
}

// DataFixed (contract 4.3). Only the routing + payload fields matter here.
const dataFixed = {
  instructionId:
    "0x0000000000000000000000000000000000000000000000000000000000000001",
  opType: OP_TYPE_CURATION,
  opCommand: OP_COMMAND_CYCLE,
  originalMessage,
};

// ActionData.message is hex-encoded UTF-8 JSON of the DataFixed (double-encoded).
const message = utf8ToHex(JSON.stringify(dataFixed));

const action = {
  data: {
    id: "0x0000000000000000000000000000000000000000000000000000000000000001",
    type: "instruction",
    submissionTag: "submit",
    message,
  },
};

// --- minimal ABI decode of the returned Plan tuple (viem-free) ---
// Layout: one dynamic tuple; head is a 32-byte offset to the tuple body.
function hexToBytes(h) {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function word(bytes, off) {
  return bytes.slice(off, off + 32);
}
function toBig(w) {
  return BigInt("0x" + Buffer.from(w).toString("hex"));
}
function toHex32(w) {
  return "0x" + Buffer.from(w).toString("hex");
}

function decodePlan(dataHex) {
  const b = hexToBytes(dataHex);
  const tupleOff = Number(toBig(word(b, 0)));
  const base = tupleOff;
  const planId = toHex32(word(b, base + 0 * 32));
  const modelVersion = toBig(word(b, base + 1 * 32));
  const codeHash = toHex32(word(b, base + 2 * 32));
  const nonce = toBig(word(b, base + 3 * 32));
  const expiry = toBig(word(b, base + 4 * 32));
  const totalOut = toBig(word(b, base + 5 * 32));
  const reserveAmount = toBig(word(b, base + 6 * 32));
  const allocOff = Number(toBig(word(b, base + 7 * 32)));
  const allocBase = base + allocOff;
  const n = Number(toBig(word(b, allocBase)));
  const allocations = [];
  for (let i = 0; i < n; i++) {
    const o = allocBase + 32 + i * 64;
    allocations.push({
      venueId: toBig(word(b, o)),
      amount: toBig(word(b, o + 32)),
    });
  }
  return { planId, modelVersion, codeHash, nonce, expiry, totalOut, reserveAmount, allocations };
}

const VENUE = { 0: "FXRP", 1: "USDT0", 2: "WFLR" };
const fmt = (x) => (Number(x) / 1e18).toFixed(4);

async function main() {
  console.log(`POST ${URL}`);
  console.log(`opType   ${OP_TYPE_CURATION}`);
  console.log(`opCommand ${OP_COMMAND_CYCLE}`);
  console.log(`originalMessage ${originalMessage === "0x" ? "(empty -> bundled snapshot)" : originalMessage.slice(0, 18) + "..."}`);

  const res = await fetch(URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(action),
  });
  const body = await res.json();
  console.log(`\nHTTP ${res.status}  status=${body.status}  log=${body.log ?? ""}`);

  if (body.status !== 1 || !body.data || body.data === "0x") {
    console.error("Handler did not return a Plan. Full response:");
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }

  const p = decodePlan(body.data);
  console.log("\nAVV Plan (enclave-computed):");
  console.log(`  planId        ${p.planId}`);
  console.log(`  modelVersion  ${p.modelVersion}`);
  console.log(`  nonce         ${p.nonce}   expiry ${p.expiry}`);
  console.log(`  totalOut      ${fmt(p.totalOut)}   reserve ${fmt(p.reserveAmount)}`);
  let deployed = 0n;
  for (const a of p.allocations) {
    deployed += a.amount;
    console.log(`  venue ${a.venueId} ${VENUE[a.venueId] ?? "?"}  ${fmt(a.amount)}`);
  }
  console.log(`  sum(alloc)+reserve = ${fmt(deployed + p.reserveAmount)} (== totalOut ${fmt(p.totalOut)})`);
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});
