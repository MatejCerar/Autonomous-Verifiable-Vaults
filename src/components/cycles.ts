// Read recent CyclePushed events from the AllocationDisplay vault via getLogs.
// Used by the ACTIVITY feed. The event carries the full allocation, so each row
// links to the on-chain write tx (log.transactionHash) with no extra reads.
// No emojis, no em dashes (house style).
import { parseAbiItem, type Hex, type PublicClient } from "viem";
import { ALLOCATION_DISPLAY } from "@/tee.config";

// event CyclePushed(uint256 indexed cycleId, bytes32 indexed planId,
//   uint256 totalOut, uint256 reserveAmount, uint256[3] amounts, uint64 timestamp)
export const CYCLE_PUSHED_EVENT = parseAbiItem(
  "event CyclePushed(uint256 indexed cycleId, bytes32 indexed planId, uint256 totalOut, uint256 reserveAmount, uint256[3] amounts, uint64 timestamp)",
);

// How far back to scan when the contract's first-seen block is unknown. Coston2
// mines ~1 block/1.8s, so ~400k blocks is roughly a week: plenty for a demo and
// still a bounded getLogs request.
const LOOKBACK_BLOCKS = 400_000n;

export interface CycleEvent {
  cycleId: bigint;
  planId: Hex;
  totalOut: bigint;
  reserveAmount: bigint;
  amounts: readonly [bigint, bigint, bigint];
  timestamp: bigint;
  txHash: Hex;
  blockNumber: bigint;
}

/**
 * Fetch recent CyclePushed logs, newest first, capped at `limit`. Returns [] on
 * any read failure (the feed is a nice-to-have and must never break the page).
 */
export async function readRecentCycles(
  pub: PublicClient,
  limit = 10,
): Promise<CycleEvent[]> {
  // Public Coston2 RPCs cap eth_getLogs at ~30 blocks, so reading cycle history
  // via logs is not possible here (it would hang/spin). Return empty; the feed
  // is filled from cycles run in this session (prepended in App.tsx).
  return [];
  // eslint-disable-next-line no-unreachable
  if (!ALLOCATION_DISPLAY) return [];
  try {
    const head = await pub.getBlockNumber();
    const fromBlock = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
    const logs = await pub.getLogs({
      address: ALLOCATION_DISPLAY as Hex,
      event: CYCLE_PUSHED_EVENT,
      fromBlock,
      toBlock: "latest",
    });
    const rows: CycleEvent[] = logs.map((log) => {
      const a = log.args as {
        cycleId: bigint;
        planId: Hex;
        totalOut: bigint;
        reserveAmount: bigint;
        amounts: readonly [bigint, bigint, bigint];
        timestamp: bigint;
      };
      return {
        cycleId: a.cycleId,
        planId: a.planId,
        totalOut: a.totalOut,
        reserveAmount: a.reserveAmount,
        amounts: a.amounts,
        timestamp: a.timestamp,
        txHash: log.transactionHash as Hex,
        blockNumber: log.blockNumber ?? 0n,
      };
    });
    rows.sort((x, y) => Number(y.cycleId - x.cycleId));
    return rows.slice(0, limit);
  } catch {
    return [];
  }
}
