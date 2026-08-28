import { formatUnits } from "viem";

// Formatting helpers for the Mystic allocation demo.
// No emojis, no em dashes in this file (house style).

export function truncateHex(hex: string, head = 10, tail = 8): string {
  if (hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head)}...${hex.slice(-tail)}`;
}

/** Fractional rate (0.0366 = 3.66%) -> percent string. */
export function fmtPct(frac: number, dp = 2): string {
  return `${(frac * 100).toFixed(dp)}%`;
}

/** USD number -> $ string. */
export function fmtUsd(n: number, dp = 0): string {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: dp,
    minimumFractionDigits: 0,
  });
}

/** Compact USD ($1.2M, $32k). */
export function fmtUsdCompact(n: number): string {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

/** A base-unit integer string + token decimals -> human token amount. */
export function fmtTokenUnits(base: string | bigint, decimals: number): string {
  try {
    const v = typeof base === "string" ? BigInt(base) : base;
    const s = formatUnits(v, decimals);
    const n = Number(s);
    if (!Number.isFinite(n)) return s;
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  } catch {
    return String(base);
  }
}

/** Plain number -> token amount with grouping. */
export function fmtToken(n: number, dp = 2): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: dp });
}

export function fmtBips(bips: number): string {
  return `${(bips / 100).toFixed(2)}%`;
}

export function fmtTimestamp(ts?: string | number): string {
  if (ts === undefined) return "-";
  const n = Number(ts);
  if (!Number.isFinite(n)) return String(ts);
  return new Date(n * 1000).toLocaleString();
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** FTSO feed integer value + int8 decimals -> display string. */
export function fmtFeed(value?: string, decimals?: number): string {
  if (value === undefined || decimals === undefined) return "-";
  try {
    return formatUnits(BigInt(value), decimals);
  } catch {
    return value;
  }
}
