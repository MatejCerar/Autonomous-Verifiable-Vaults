// The on-chain mandate: the bounded-plan checks a CurationController would
// enforce before releasing funds. We evaluate them here in the browser against
// the TEE-signed envelope so the demo can show each allocation passing its cap
// and, for the bad plan, exactly which check trips. This mirrors the reference
// AVV reject-reason display, re-skinned for the Mystic multi-token mandate.
//
// No emojis, no em dashes in this file (house style).
import type { Envelope } from "@/data";

// Mandate parameters (bips of vault TVL / totalOut). These match
// optimizer/result.json params: cap 0.30, maxTotalOut 0.80, reserveFloor 0.20.
export const MANDATE = {
  venueCapBips: 3000, // 30% per venue
  maxTotalOutBips: 8000, // 80% total deployed
  minReserveBips: 2000, // 20% reserve floor
} as const;

export type CheckState = "pass" | "fail" | "idle";

export interface CheckRow {
  key: string;
  label: string;
  detail: string;
  state: CheckState;
}

const BIPS = 10000n;

function sumAllocations(env: Envelope): bigint {
  return env.plan.allocations.reduce((acc, a) => acc + BigInt(a.amount), 0n);
}

/**
 * Evaluate the bounded-plan mandate against an envelope. `totalOut` is the
 * plan-declared budget (the vault TVL basis for the cap fractions). Returns the
 * ordered check rows plus the first failing reason (undefined = all pass).
 */
export function evaluateMandate(env: Envelope): {
  rows: CheckRow[];
  reject?: string;
} {
  const totalOut = BigInt(env.plan.totalOut);
  const reserve = BigInt(env.plan.reserveAmount);
  const allocSum = sumAllocations(env);

  const venueCap = (totalOut * BigInt(MANDATE.venueCapBips)) / BIPS;
  const maxTotalOut = (totalOut * BigInt(MANDATE.maxTotalOutBips)) / BIPS;
  const minReserve = (totalOut * BigInt(MANDATE.minReserveBips)) / BIPS;

  const rows: CheckRow[] = [];
  let reject: string | undefined;

  const push = (
    key: string,
    label: string,
    detail: string,
    ok: boolean,
  ): boolean => {
    // Once a check has failed, later checks never run (idle), matching the
    // short-circuit ordering of the on-chain validator.
    if (reject) {
      rows.push({ key, label, detail, state: "idle" });
      return false;
    }
    rows.push({ key, label, detail, state: ok ? "pass" : "fail" });
    if (!ok) reject = key;
    return ok;
  };

  // 1. reserve floor: reserve >= 20% of totalOut
  push(
    "reserve floor",
    "reserve >= 20% of budget",
    `${fmtUsdBig(reserve)} >= ${fmtUsdBig(minReserve)}`,
    reserve >= minReserve,
  );

  // 2. total-out cap: sum(allocs) <= 80% of totalOut
  push(
    "over total cap",
    "total deployed <= 80% of budget",
    `${fmtUsdBig(allocSum)} <= ${fmtUsdBig(maxTotalOut)}`,
    allocSum <= maxTotalOut,
  );

  // 3. per-venue cap: each alloc <= 30% of totalOut
  for (const a of env.plan.allocations) {
    const amt = BigInt(a.amount);
    push(
      `venue cap #${a.venueId}`,
      `venue #${a.venueId} <= 30% cap`,
      `${fmtUsdBig(amt)} <= ${fmtUsdBig(venueCap)}`,
      amt <= venueCap,
    );
  }

  // 4. totals identity: sum(allocs) + reserve == totalOut
  push(
    "totals mismatch",
    "sum(allocs) + reserve == budget",
    `${fmtUsdBig(allocSum + reserve)} == ${fmtUsdBig(totalOut)}`,
    allocSum + reserve === totalOut,
  );

  return { rows, reject };
}

// The plan amounts are USD notional carried as 1e18-scaled integers (the
// capital is 1,000,000 USD -> 1e24). Render them as plain USD.
export function fmtUsdBig(wei: bigint): string {
  const usd = Number(wei / 10n ** 12n) / 1e6;
  if (!Number.isFinite(usd)) return wei.toString();
  return usd.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
