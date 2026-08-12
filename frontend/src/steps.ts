import type { RevertReason } from "@/chain";

// The 8 ordered on-chain checks from preimage.md, in execution order.
export interface CheckRow {
  reason: RevertReason;
  label: string;
}

export const VALIDATION_CHECKS: CheckRow[] = [
  { reason: "replay", label: "planId not replayed" },
  { reason: "bad nonce", label: "nonce == controller.nonce()" },
  { reason: "expired", label: "expiry > block.timestamp" },
  { reason: "bad fingerprint", label: "modelVersion + codeHash enabled" },
  { reason: "bad signer", label: "signer == registered TEE key" },
  { reason: "reserve floor", label: "reserve >= minReserve of TVL" },
  { reason: "over total cap", label: "totalOut <= maxTotalOut of TVL" },
  { reason: "over venue cap", label: "each alloc <= venue cap of TVL" },
  { reason: "totals mismatch", label: "sum(allocs) + reserve == totalOut" },
];

export type CheckState = "idle" | "pass" | "fail";

/** Given a revert (or undefined for success), produce a per-row state map. */
export function checkStates(
  revert: RevertReason | undefined,
  ran: boolean,
): Record<string, CheckState> {
  const map: Record<string, CheckState> = {};
  if (!ran) {
    for (const c of VALIDATION_CHECKS) map[c.reason] = "idle";
    return map;
  }
  if (!revert) {
    for (const c of VALIDATION_CHECKS) map[c.reason] = "pass";
    return map;
  }
  // Reverted: every check before the failing one passed, the failing one is
  // red, and checks after it never ran (idle).
  const failIdx = VALIDATION_CHECKS.findIndex((c) => c.reason === revert);
  VALIDATION_CHECKS.forEach((c, i) => {
    if (failIdx === -1) {
      map[c.reason] = "idle";
    } else if (i < failIdx) {
      map[c.reason] = "pass";
    } else if (i === failIdx) {
      map[c.reason] = "fail";
    } else {
      map[c.reason] = "idle";
    }
  });
  return map;
}
