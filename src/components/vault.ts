// Shared helpers for the vault dashboard: venue metadata, on-chain amount
// formatting, and a compact allocation-summary builder. Venue order is fixed
// by the AllocationDisplay contract: [0]=FXRP, [1]=USDT0, [2]=WFLR.
// No emojis, no em dashes (house style).
import { formatUnits, type Hex } from "viem";

/** Fixed venue vector order the display vault stores (amounts are USD 1e18). */
export const VENUES = [
  { key: "FXRP", label: "FXRP", color: "#fe256d" },
  { key: "USDT0", label: "USDT0", color: "#26c2a3" },
  { key: "WFLR", label: "WFLR", color: "#f7931a" },
] as const;

export const RESERVE = { key: "reserve", label: "Reserve", color: "#7b8794" };

/** A USD 1e18 base-unit integer -> plain number of dollars. */
export function usdFromWei(v: bigint): number {
  return Number(formatUnits(v, 18));
}

/** USD number -> "$1,000,000" (whole dollars, grouped). */
export function fmtDollars(n: number, dp = 0): string {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: dp,
    minimumFractionDigits: 0,
  });
}

/** Fraction (0.085) -> "8.5%". */
export function fmtPercent(frac: number, dp = 1): string {
  return `${(frac * 100).toFixed(dp)}%`;
}

/** Short hex for addresses/hashes: 0x1234...abcd */
export function shortHex(hex: string, head = 6, tail = 4): string {
  if (!hex) return "";
  if (hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head)}...${hex.slice(-tail)}`;
}

/** Relative-time string from a unix seconds timestamp: "12s ago", "3m ago". */
export function relativeTime(unixSeconds: number, now = Date.now()): string {
  const secs = Math.max(0, Math.floor(now / 1000) - unixSeconds);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** One row per slice, USD + fraction-of-total, in the fixed display order. */
export interface AllocSlice {
  key: string;
  label: string;
  color: string;
  usd: bigint;
  frac: number;
}

/**
 * Build the [FXRP, USDT0, WFLR, reserve] slice rows from an on-chain cycle.
 * total = sum(amounts) + reserve (this is what the vault reports as totalOut +
 * reserve, but we recompute defensively from the components).
 */
export function buildSlices(
  amounts: readonly [bigint, bigint, bigint],
  reserve: bigint,
): { slices: AllocSlice[]; totalWei: bigint } {
  const totalWei = amounts[0] + amounts[1] + amounts[2] + reserve;
  const denom = totalWei === 0n ? 1n : totalWei;
  const venueSlices: AllocSlice[] = VENUES.map((v, i) => ({
    key: v.key,
    label: v.label,
    color: v.color,
    usd: amounts[i],
    frac: Number((amounts[i] * 10000n) / denom) / 10000,
  }));
  const reserveSlice: AllocSlice = {
    key: RESERVE.key,
    label: RESERVE.label,
    color: RESERVE.color,
    usd: reserve,
    frac: Number((reserve * 10000n) / denom) / 10000,
  };
  return { slices: [...venueSlices, reserveSlice], totalWei };
}

/** "FXRP 40% / USDT0 20% / WFLR 20% / Reserve 20%" one-liner for the feed. */
export function summaryLine(
  amounts: readonly [bigint, bigint, bigint],
  reserve: bigint,
): string {
  const { slices } = buildSlices(amounts, reserve);
  return slices
    .filter((s) => s.usd > 0n)
    .map((s) => `${s.label} ${fmtPercent(s.frac, 0)}`)
    .join(" / ");
}

/** True when the cycle struct is the zeroed "no cycle yet" sentinel. */
export function isEmptyCycle(cycleId: bigint, totalOut: bigint, reserve: bigint): boolean {
  return cycleId === 0n && totalOut === 0n && reserve === 0n;
}

export type { Hex };
