// Standalone AVV enclave service (bundled to enclave-service.mjs).
//
// Runs the SAME model + TEE signing as the Flare enclave handler: given a market
// snapshot it runs the optimizer, builds the PlanLib.Plan, and EIP-191-signs the
// plan preimage with the TEE key whose address is the registered
// MandateRegistry.teeAddress. Serves POST /curation {market, nonce} with CORS,
// returning abi.encode(Plan, signature). The frontend then calls
// CurationController.executePlan on Coston2. Attestation is simulated (same as
// the full docker stack with SIMULATED_TEE=true).
//
// No emojis, no em dashes.
import http from "node:http";
import { buildPlan, signPlan, encodePlanWithSig } from "./extension/avv.js";
import { VENDORED_MARKET_DATA } from "./extension/vendor/marketData.js";
import type { MarketData } from "./extension/vendor/optimize.js";

const PORT = Number(process.env.PORT || 8799);
const SIGNER = (process.env.TEE_PLAN_SIGNER_KEY ||
  "0x6fccfd706182c24a8c22f959077d79fd937673a2625dc77c880422f50c77c38a") as `0x${string}`;
const CONTROLLER = (process.env.AVV_CONTROLLER ||
  "0x47A4E99f26F3ABF95Ca09f81399ECf84b04F3909") as `0x${string}`;
const CHAIN_ID = BigInt(process.env.AVV_CHAIN_ID || "114");
const CODE_HASH = (process.env.AVV_CODE_HASH ||
  "0x4c1ea64a6a81ce2cae7c1aaff36fcdbc64d9b06608471a1d346a9de1e31763ea") as `0x${string}`;
const MODEL_VERSION = BigInt(process.env.AVV_MODEL_VERSION || "1");

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST" || !req.url?.startsWith("/curation")) {
    res.writeHead(404); res.end("POST /curation"); return;
  }
  let body = "";
  for await (const c of req) body += c;
  try {
    const j = body ? JSON.parse(body) : {};
    const market: MarketData = j.market ?? VENDORED_MARKET_DATA;
    const nonce = BigInt(j.nonce ?? "0");
    const plan = buildPlan(market, { modelVersion: MODEL_VERSION, codeHash: CODE_HASH, nonce });
    const signature = await signPlan(plan, CONTROLLER, CHAIN_ID, SIGNER);
    const data = encodePlanWithSig(plan, signature);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: 1, data, log: "ok" }));
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: 0, data: "0x", log: String(e) }));
  }
});
server.listen(PORT, () => console.log(`AVV enclave service on :${PORT} (teeAddress signer)`));
