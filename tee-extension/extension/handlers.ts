/**
 * ★ MAIN CUSTOMIZATION POINT: your extension's handlers.
 *
 * Mirrors go/internal/extension/extension.go. Each handler follows the same
 * 4-step pattern: decode, validate, execute, respond.
 *
 * Handler contract:
 *   (originalMessageHex) => [dataHexOrNull, status, errorOrNull]
 *   status 0 = error, 1 = success. See docs/extension-contract.md §4.6.
 *
 * The framework serializes handler calls, so plain module-level state is safe.
 */

import { bytesToHex, hexToBytes } from "../base/encoding.js";
import type { Framework, HandlerResult } from "../base/types.js";

import { decodeSayGoodbye } from "./abi.js";
import { buildPlan, encodePlan, encodePlanWithSig, signPlan } from "./avv.js";
import {
  OP_COMMAND_CYCLE,
  OP_COMMAND_SAY_GOODBYE,
  OP_COMMAND_SAY_HELLO,
  OP_TYPE_CURATION,
  OP_TYPE_GREETING,
} from "./config.js";
import type { MarketData } from "./vendor/optimize.js";
import { VENDORED_MARKET_DATA } from "./vendor/marketData.js";

// --- Extension state ---------------------------------------------------------
// Serialized by the framework; no locking needed here.
let greetingCount = 0;
let lastGreeting = "";
let farewellCount = 0;
let lastFarewell = "";

// AVV CURATION/CYCLE state. Kept separate from the conformance-pinned greeting
// state so reportState() (compared byte-for-byte by the conformance fixtures)
// is never changed.
let curationCycleCount = 0;
let lastPlanId = "";

/** Reset all state. Used by tests; not part of the wire contract. */
export function resetState(): void {
  greetingCount = 0;
  lastGreeting = "";
  farewellCount = 0;
  lastFarewell = "";
  curationCycleCount = 0;
  lastPlanId = "";
}

/** Wire handlers to (opType, opCommand) pairs. */
export function register(framework: Framework): void {
  framework.handle(OP_TYPE_GREETING, OP_COMMAND_SAY_HELLO, handleSayHello);
  framework.handle(OP_TYPE_GREETING, OP_COMMAND_SAY_GOODBYE, handleSayGoodbye);
  framework.handle(OP_TYPE_CURATION, OP_COMMAND_CYCLE, handleCurationCycle);
}

/**
 * Snapshot returned by GET /state. Mirrors the Go State struct.
 *
 * DO NOT add fields here: the conformance fixtures compare this byte-for-byte.
 * AVV cycle state is exposed separately via reportCurationState().
 */
export function reportState(): unknown {
  return {
    greetingCount,
    lastGreeting,
    farewellCount,
    lastFarewell,
  };
}

/** AVV cycle counter, kept out of the conformance-pinned reportState(). */
export function reportCurationState(): unknown {
  return {
    curationCycleCount,
    lastPlanId,
  };
}

/** GREETING/SAY_HELLO — JSON payload {"name": "..."}. */
export function handleSayHello(msg: string): HandlerResult {
  // 1. Decode
  let raw: Uint8Array;
  try {
    raw = hexToBytes(msg);
  } catch (e) {
    return [null, 0, `decoding request: invalid hex: ${String(e)}`];
  }

  let req: unknown;
  try {
    req = JSON.parse(Buffer.from(raw).toString("utf-8"));
  } catch (e) {
    return [null, 0, `decoding request: ${String(e)}`];
  }

  if (typeof req !== "object" || req === null || Array.isArray(req)) {
    return [null, 0, "decoding request: expected a JSON object"];
  }

  // Match Go's DisallowUnknownFields.
  const unknown = Object.keys(req).filter((k) => k !== "name").sort();
  if (unknown.length > 0) {
    return [null, 0, `decoding request: unknown field "${unknown[0]}"`];
  }

  // 2. Validate
  const name = (req as { name?: unknown }).name;
  if (typeof name !== "string" || name === "") {
    return [null, 0, "name must not be empty"];
  }

  // 3. Execute
  greetingCount++;
  const greeting = `Hello, ${name}! Welcome to Flare Confidential Compute.`;
  lastGreeting = greeting;

  // 4. Respond
  const resp = { greeting, greetingNumber: greetingCount };
  return [bytesToHex(Buffer.from(JSON.stringify(resp), "utf-8")), 1, null];
}

/** GREETING/SAY_GOODBYE — ABI-encoded (string name, string reason). */
export function handleSayGoodbye(msg: string): HandlerResult {
  // 1. Decode
  let hex: string;
  try {
    // Normalize through hexToBytes so malformed input fails here, not in viem.
    hex = bytesToHex(hexToBytes(msg));
  } catch (e) {
    return [null, 0, `decoding request: invalid hex: ${String(e)}`];
  }

  let decoded: { name: string; reason: string };
  try {
    decoded = decodeSayGoodbye(hex as `0x${string}`);
  } catch (e) {
    return [null, 0, `decoding request: ${e instanceof Error ? e.message : String(e)}`];
  }

  // 2. Validate
  if (!decoded.name) {
    return [null, 0, "name must not be empty"];
  }

  // 3. Execute
  farewellCount++;
  const farewell = `Goodbye, ${decoded.name}! Reason: ${decoded.reason}`;
  lastFarewell = farewell;

  // 4. Respond
  const resp = { farewell, farewellNumber: farewellCount };
  return [bytesToHex(Buffer.from(JSON.stringify(resp), "utf-8")), 1, null];
}

/**
 * CURATION/CYCLE - run the AVV optimizer and return an ABI-encoded PlanLib.Plan.
 *
 * The message is a hex-encoded UTF-8 JSON market snapshot (the research schema).
 * An empty message ("0x") means "use the enclave's bundled snapshot", matching
 * sendCuration(bytes) passing "0x". The returned data is abi.encode(Plan), which
 * the frontend decodes with decodeAbiParameters(PLAN_ABI, data).
 */
export async function handleCurationCycle(msg: string): Promise<HandlerResult> {
  // 1. Decode. The message is either a raw market snapshot, or an envelope
  //    {"market": <snapshot>, "nonce": <controller.nonce()>} so the plan is
  //    signed with the fresh on-chain nonce.
  let raw: Uint8Array;
  try {
    raw = hexToBytes(msg);
  } catch (e) {
    return [null, 0, `decoding request: invalid hex: ${String(e)}`];
  }

  let marketData: MarketData;
  let nonce = 0n;
  if (raw.length === 0) {
    marketData = VENDORED_MARKET_DATA;
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(raw).toString("utf-8"));
    } catch (e) {
      return [null, 0, `decoding request: ${String(e)}`];
    }
    const obj = parsed as { market?: MarketData; nonce?: string | number };
    if (obj && typeof obj === "object" && obj.market != null) {
      marketData = obj.market;
      if (obj.nonce != null) nonce = BigInt(obj.nonce);
    } else {
      marketData = parsed as MarketData;
    }
    if (
      typeof marketData !== "object" ||
      marketData === null ||
      Array.isArray(marketData) ||
      marketData.assets == null
    ) {
      return [null, 0, "decoding request: expected a market-data object with assets"];
    }
  }

  // Enclave-held config: the plan-signer key, the CurationController address it
  // domain-separates on, the enabled model fingerprint + version.
  const signerKey = process.env.TEE_PLAN_SIGNER_KEY as `0x${string}` | undefined;
  const controller = process.env.AVV_CONTROLLER as `0x${string}` | undefined;
  const chainId = BigInt(process.env.AVV_CHAIN_ID ?? "114");
  const codeHash = (process.env.AVV_CODE_HASH as `0x${string}` | undefined) ?? undefined;
  const modelVersion = BigInt(process.env.AVV_MODEL_VERSION ?? "1");

  // 2. Build + 3. Sign
  let dataHex: string;
  let planId: string;
  try {
    const plan = buildPlan(marketData, { modelVersion, codeHash, nonce });
    planId = plan.planId;
    if (signerKey && controller) {
      const signature = await signPlan(plan, controller, chainId, signerKey);
      dataHex = encodePlanWithSig(plan, signature);
    } else {
      dataHex = encodePlan(plan);
    }
  } catch (e) {
    return [null, 0, `curation cycle failed: ${e instanceof Error ? e.message : String(e)}`];
  }

  // 4. Respond
  curationCycleCount++;
  lastPlanId = planId;
  return [dataHex, 1, null];
}
