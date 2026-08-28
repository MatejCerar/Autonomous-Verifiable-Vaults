// The on-chain mandate: the bounded-plan checks a CurationController enforces
// before releasing funds. We evaluate them in the browser against the TEE-signed
// envelope so the demo can show each check passing and, for a bad plan, exactly
// which check trips and why - byte-for-byte in the same order the contract does
// (see ../../schema/preimage.md and contracts/src/CurationController.sol).
//
// The headline "verify, don't trust" case is BAD SIGNER: a plan that is
// perfectly in-mandate (every cap satisfied, reserve above floor, valid
// fingerprint) is still REJECTED because it was signed by an enclave key that is
// not the one registered in the mandate. The browser recovers the plan's signer
// from the exact planHash preimage and compares it to the registered TEE address,
// mirroring the on-chain ecrecover.
//
// No emojis, no em dashes in this file (house style).
import type { Envelope } from "@/data";
import { recoverPlanSigner } from "@/signer";

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

// The mandate reference the checks compare against: the registered TEE enclave
// address (whoever signed the valid plan) and the enabled model fingerprint.
export interface MandateRef {
  teeAddress: string; // registered write-once enclave key
  codeHash: string; // enabled model fingerprint
}

export interface MandateResult {
  rows: CheckRow[];
  reject?: string;
}

const BIPS = 10000n;

function sumAllocations(env: Envelope): bigint {
  return env.plan.allocations.reduce((acc, a) => acc + BigInt(a.amount), 0n);
}

/**
 * Build the mandate reference from the VALID (accepted) envelope: its recovered
 * signer IS the registered TEE address, and its codeHash IS the enabled
 * fingerprint. This is the enclave the mandate is bound to.
 */
export async function deriveMandateRef(good: Envelope): Promise<MandateRef> {
  return {
    teeAddress: await recoverPlanSigner(good),
    codeHash: good.plan.codeHash,
  };
}

/**
 * Evaluate the bounded-plan mandate against an envelope, in the on-chain check
 * order. Returns the ordered check rows plus the first failing reason
 * (undefined = all pass). Async because the signer check recovers ECDSA.
 */
export async function evaluateMandate(
  env: Envelope,
  ref: MandateRef,
): Promise<MandateResult> {
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

  // Recover the enclave that signed this plan (the on-chain ecrecover, off-chain).
  const signer = await recoverPlanSigner(env);
  const fingerprintOk =
    env.plan.codeHash.toLowerCase() === ref.codeHash.toLowerCase();
  const signerOk = signer.toLowerCase() === ref.teeAddress.toLowerCase();

  // 4. bad fingerprint: codeHash must be the enabled model fingerprint.
  push(
    "bad fingerprint",
    "codeHash is the enabled fingerprint",
    fingerprintOk
      ? `${short(env.plan.codeHash)} enabled`
      : `${short(env.plan.codeHash)} != ${short(ref.codeHash)}`,
    fingerprintOk,
  );

  // 5. bad signer: recovered signer must be the registered TEE enclave. This is
  //    the "verify, don't trust" check - it fails even for an in-mandate plan.
  push(
    "bad signer",
    "signer is the registered TEE enclave",
    signerOk
      ? `${short(signer)} (registered)`
      : `${short(signer)} != ${short(ref.teeAddress)}`,
    signerOk,
  );

  // 6. reserve floor: reserve >= 20% of totalOut
  push(
    "reserve floor",
    "reserve >= 20% of budget",
    `${fmtUsdBig(reserve)} >= ${fmtUsdBig(minReserve)}`,
    reserve >= minReserve,
  );

  // 7. total-out cap: sum(allocs) <= 80% of totalOut
  push(
    "over total cap",
    "total deployed <= 80% of budget",
    `${fmtUsdBig(allocSum)} <= ${fmtUsdBig(maxTotalOut)}`,
    allocSum <= maxTotalOut,
  );

  // 8. per-venue cap: each alloc <= 30% of totalOut
  for (const a of env.plan.allocations) {
    const amt = BigInt(a.amount);
    push(
      `venue cap #${a.venueId}`,
      `venue #${a.venueId} <= 30% cap`,
      `${fmtUsdBig(amt)} <= ${fmtUsdBig(venueCap)}`,
      amt <= venueCap,
    );
  }

  // 9. totals identity: sum(allocs) + reserve == totalOut
  push(
    "totals mismatch",
    "sum(allocs) + reserve == budget",
    `${fmtUsdBig(allocSum + reserve)} == ${fmtUsdBig(totalOut)}`,
    allocSum + reserve === totalOut,
  );

  return { rows, reject };
}

function short(hex: string): string {
  if (hex.length <= 14) return hex;
  return `${hex.slice(0, 8)}...${hex.slice(-4)}`;
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
