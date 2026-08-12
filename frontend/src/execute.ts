import type { Address } from "viem";
import {
  abis,
  addresses,
  asAddress,
  parseRevertReason,
  publicClient,
  walletClient,
  type RevertReason,
} from "@/chain";
import type { Envelope, Plan } from "@/model";

// Map a Plan (string wire form) into the on-chain tuple (bigint / hex).
export function toOnChainPlan(plan: Plan) {
  return {
    planId: plan.planId as `0x${string}`,
    modelVersion: BigInt(plan.modelVersion),
    codeHash: plan.codeHash as `0x${string}`,
    nonce: BigInt(plan.nonce),
    expiry: BigInt(plan.expiry),
    totalOut: BigInt(plan.totalOut),
    reserveAmount: BigInt(plan.reserveAmount),
    allocations: plan.allocations.map((a) => ({
      venueId: BigInt(a.venueId),
      amount: BigInt(a.amount),
    })),
  };
}

export interface ExecuteResult {
  ok: boolean;
  txHash?: `0x${string}`;
  revert?: RevertReason;
  error?: string;
}

/**
 * Submit executePlan(plan, signature). Simulates first so a bad plan reverts
 * with the frozen reason string (no gas spent, matches on-chain check order).
 */
export async function executePlan(env: Envelope): Promise<ExecuteResult> {
  const controller = asAddress(addresses.deployed.curationController);
  const planTuple = toOnChainPlan(env.plan);
  const signature = env.signature as `0x${string}`;

  try {
    const { request } = await publicClient.simulateContract({
      account: walletClient.account,
      address: controller,
      abi: abis.curationController,
      functionName: "executePlan",
      args: [planTuple, signature],
    });
    const txHash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return { ok: true, txHash };
  } catch (err) {
    const revert = parseRevertReason(err);
    return {
      ok: false,
      revert,
      error: revert ? undefined : (err as Error)?.message ?? String(err),
    };
  }
}

export async function readNonce(): Promise<bigint> {
  return publicClient.readContract({
    address: asAddress(addresses.deployed.curationController),
    abi: abis.curationController,
    functionName: "nonce",
  });
}

export async function readNav(): Promise<{
  totalAssets: bigint;
  totalSupply: bigint;
  sharePrice: bigint; // assets per 1e18 shares
}> {
  const vault = asAddress(addresses.deployed.vault);
  const totalAssets = await publicClient.readContract({
    address: vault,
    abi: abis.vault,
    functionName: "totalAssets",
  });
  let totalSupply = 0n;
  try {
    totalSupply = await publicClient.readContract({
      address: vault,
      abi: abis.vault,
      functionName: "totalSupply",
    });
  } catch {
    totalSupply = 0n;
  }
  let sharePrice = 10n ** 18n;
  try {
    sharePrice = await publicClient.readContract({
      address: vault,
      abi: abis.vault,
      functionName: "convertToAssets",
      args: [10n ** 18n],
    });
  } catch {
    sharePrice = totalSupply > 0n ? (totalAssets * 10n ** 18n) / totalSupply : 10n ** 18n;
  }
  return { totalAssets, totalSupply, sharePrice };
}

export interface VenueState {
  venueId: number;
  adapter: Address;
  balance: bigint;
  hardCap: bigint;
  capBips: bigint; // mandate cap in bips (of TVL)
  capAmount: bigint; // capBips applied to TVL
}

export async function readVenues(tvl: bigint): Promise<VenueState[]> {
  const registry = asAddress(addresses.deployed.mandateRegistry);
  const adaptersList = addresses.deployed.venueAdapters;
  const out: VenueState[] = [];
  for (let i = 0; i < adaptersList.length; i++) {
    const adapter = asAddress(adaptersList[i]);
    let venueId = i;
    try {
      venueId = Number(
        await publicClient.readContract({
          address: adapter,
          abi: abis.venueAdapter,
          functionName: "venueId",
        }),
      );
    } catch {
      venueId = i;
    }
    const balance = await publicClient.readContract({
      address: adapter,
      abi: abis.venueAdapter,
      functionName: "balanceOf",
      args: [asAddress(addresses.deployed.vault)],
    });
    let hardCap = 0n;
    try {
      hardCap = await publicClient.readContract({
        address: adapter,
        abi: abis.venueAdapter,
        functionName: "hardCap",
      });
    } catch {
      hardCap = 0n;
    }
    let capBips = 0n;
    try {
      capBips = await publicClient.readContract({
        address: registry,
        abi: abis.mandateRegistry,
        functionName: "venueCapBips",
        args: [BigInt(venueId)],
      });
    } catch {
      capBips = 0n;
    }
    const capAmount = (tvl * capBips) / 10000n;
    out.push({ venueId, adapter, balance, hardCap, capBips, capAmount });
  }
  return out;
}

export async function readReserve(): Promise<bigint> {
  const reserve = addresses.deployed.reserveAdapter;
  if (!reserve) return 0n;
  try {
    return await publicClient.readContract({
      address: asAddress(reserve),
      abi: abis.reserveAdapter,
      functionName: "balanceOf",
      args: [asAddress(addresses.deployed.vault)],
    });
  } catch {
    return 0n;
  }
}
