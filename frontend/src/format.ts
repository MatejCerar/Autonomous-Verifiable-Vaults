import { formatUnits } from "viem";

export function truncateHex(hex: string, head = 10, tail = 8): string {
  if (hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head)}...${hex.slice(-tail)}`;
}

/** Format an 18-decimal wei string/bigint to a human token amount. */
export function fmtToken(wei: bigint | string, dp = 2): string {
  const v = typeof wei === "string" ? BigInt(wei) : wei;
  const s = formatUnits(v, 18);
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

export function fmtBips(bips: bigint | number): string {
  const b = typeof bips === "bigint" ? Number(bips) : bips;
  return `${(b / 100).toFixed(2)}%`;
}

/** FTSO feed value with its int8 decimals -> display number. */
export function fmtFeed(value?: string, decimals?: number): string {
  if (value === undefined || decimals === undefined) return "-";
  try {
    return formatUnits(BigInt(value), decimals);
  } catch {
    return value;
  }
}

export function fmtTimestamp(ts?: string): string {
  if (!ts) return "-";
  const n = Number(ts);
  if (!Number.isFinite(n)) return ts;
  return new Date(n * 1000).toLocaleString();
}
