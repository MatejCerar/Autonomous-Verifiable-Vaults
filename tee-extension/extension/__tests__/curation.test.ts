/**
 * AVV CURATION/CYCLE handler + plan-builder tests.
 *
 * Asserts the integration contract from demo-with-tee/README.md and
 * demo/schema/preimage.md: success status, 3 allocations within the 30% venue
 * cap, reserve at or above the 20% floor, totals identity
 * sum(allocations)+reserve == totalOut == capital, a deterministic planId, and
 * the empty-message ("0x") fallback to the vendored snapshot.
 */

import { decodeAbiParameters } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildPlan, encodePlan, PLAN_ABI } from "../app/avv.js";
import * as handlers from "../app/handlers.js";
import { VENDORED_MARKET_DATA } from "../app/vendor/marketData.js";
import { bytesToHex, hexToBytes } from "../base/encoding.js";
import type { HandlerResult } from "../base/types.js";

const CAPITAL = 1_000_000_000_000_000_000n; // 1.0 (1e18) USD notional
const CAP = (CAPITAL * 30n) / 100n; // 30% venue cap
const FLOOR = (CAPITAL * 20n) / 100n; // 20% reserve floor

// Fixed params so planId is deterministic across runs.
const FIXED = { nonce: 7n, expiry: 2_000_000_000n, modelVersion: 1n };

function jsonMsg(obj: unknown): string {
  return bytesToHex(Buffer.from(JSON.stringify(obj), "utf-8"));
}

function decodePlan(result: HandlerResult) {
  const [decoded] = decodeAbiParameters(PLAN_ABI, hexToBytes(result[0]!) as never);
  return decoded as unknown as {
    planId: string;
    totalOut: bigint;
    reserveAmount: bigint;
    allocations: { venueId: bigint; amount: bigint }[];
  };
}

beforeEach(() => handlers.resetState());
afterEach(() => handlers.resetState());

describe("buildPlan", () => {
  it("produces 3 allocations within the venue cap and totals that reconcile", () => {
    const plan = buildPlan(VENDORED_MARKET_DATA, FIXED);

    expect(plan.allocations).toHaveLength(3);
    expect(plan.allocations.map((a) => a.venueId)).toEqual([0n, 1n, 2n]);
    for (const a of plan.allocations) {
      expect(a.amount).toBeGreaterThanOrEqual(0n);
      expect(a.amount).toBeLessThanOrEqual(CAP);
    }

    expect(plan.reserveAmount).toBeGreaterThanOrEqual(FLOOR);
    expect(plan.totalOut).toBe(CAPITAL);

    const deployed = plan.allocations.reduce((s, a) => s + a.amount, 0n);
    expect(deployed + plan.reserveAmount).toBe(plan.totalOut);
  });

  it("is deterministic: same inputs give the same planId", () => {
    const a = buildPlan(VENDORED_MARKET_DATA, FIXED);
    const b = buildPlan(VENDORED_MARKET_DATA, FIXED);
    expect(a.planId).toBe(b.planId);
    expect(encodePlan(a)).toBe(encodePlan(b));
  });

  it("changes planId when the nonce changes", () => {
    const a = buildPlan(VENDORED_MARKET_DATA, { ...FIXED, nonce: 7n });
    const b = buildPlan(VENDORED_MARKET_DATA, { ...FIXED, nonce: 8n });
    expect(a.planId).not.toBe(b.planId);
  });
});

describe("handleCurationCycle", () => {
  it("returns status 1 and an ABI-encoded Plan for a JSON snapshot", () => {
    const r = handlers.handleCurationCycle(jsonMsg(VENDORED_MARKET_DATA));
    expect([r[1], r[2]]).toEqual([1, null]);

    const plan = decodePlan(r);
    expect(plan.allocations).toHaveLength(3);
    for (const a of plan.allocations) {
      expect(a.amount).toBeLessThanOrEqual(CAP);
    }
    expect(plan.reserveAmount).toBeGreaterThanOrEqual(FLOOR);

    const deployed = plan.allocations.reduce((s, a) => s + a.amount, 0n);
    expect(deployed + plan.reserveAmount).toBe(plan.totalOut);
    expect(plan.totalOut).toBe(CAPITAL);
  });

  it("falls back to the vendored snapshot on an empty message", () => {
    const empty = handlers.handleCurationCycle("0x");
    expect(empty[1]).toBe(1);

    // Empty "0x" and the explicit vendored snapshot must yield the same plan
    // (planId differs only by expiry, so compare the deterministic allocations).
    const explicit = handlers.handleCurationCycle(jsonMsg(VENDORED_MARKET_DATA));
    expect(decodePlan(empty).allocations).toEqual(decodePlan(explicit).allocations);
    expect(decodePlan(empty).totalOut).toBe(CAPITAL);
  });

  it("rejects invalid hex", () => {
    const r = handlers.handleCurationCycle("0xZZ");
    expect(r[1]).toBe(0);
    expect(r[2]).toContain("decoding request");
  });

  it("rejects a non-market-data JSON object", () => {
    const r = handlers.handleCurationCycle(jsonMsg({ foo: "bar" }));
    expect(r[1]).toBe(0);
    expect(r[2]).toContain("decoding request");
  });

  it("increments the AVV cycle counter without touching greeting state", () => {
    handlers.handleCurationCycle("0x");
    handlers.handleCurationCycle("0x");
    expect(handlers.reportCurationState()).toMatchObject({ curationCycleCount: 2 });
    // reportState() (conformance-pinned) is untouched.
    expect(handlers.reportState()).toEqual({
      greetingCount: 0,
      lastGreeting: "",
      farewellCount: 0,
      lastFarewell: "",
    });
  });
});
