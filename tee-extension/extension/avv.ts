/**
 * AVV allocation plan builder for the CURATION/CYCLE extension.
 *
 * Runs the vendored (pure, no-network) AVV optimizer over a market snapshot,
 * then maps the resulting per-venue weights into the on-chain PlanLib.Plan tuple
 * that the frontend and CurationController decode. See:
 *   - demo/schema/preimage.md            (the frozen Plan struct + hash preimage)
 *   - demo/contracts/src/libraries/PlanLib.sol
 *   - demo-with-tee/README.md            (the CURATION/CYCLE integration contract)
 *
 * Amounts are USD notional scaled to 1e18 (18 dp), so totalOut == capital(1e18)
 * and sum(allocation.amount) + reserveAmount == totalOut exactly.
 *
 * No emojis, no em dashes (house style).
 */

import {
  encodeAbiParameters,
  encodePacked,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { DEFAULT_PARAMS, optimize, type MarketData } from "./vendor/optimize.js";

// --- Plan ABI (PlanLib.Plan tuple, byte-for-byte with PlanLib.sol) -----------
export const PLAN_ABI = [
  {
    type: "tuple",
    components: [
      { name: "planId", type: "bytes32" },
      { name: "modelVersion", type: "uint256" },
      { name: "codeHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "totalOut", type: "uint256" },
      { name: "reserveAmount", type: "uint256" },
      {
        name: "allocations",
        type: "tuple[]",
        components: [
          { name: "venueId", type: "uint256" },
          { name: "amount", type: "uint256" },
        ],
      },
    ],
  },
] as const;

export interface Allocation {
  venueId: bigint;
  amount: bigint;
}

export interface Plan {
  planId: Hex;
  modelVersion: bigint;
  codeHash: Hex;
  nonce: bigint;
  expiry: bigint;
  totalOut: bigint;
  reserveAmount: bigint;
  allocations: Allocation[];
}

// Canonical venue ordering pinned by the integration contract.
//   0 = FXRP, 1 = USDT0, 2 = WFLR.
const VENUE_ID_BY_SYMBOL: Record<string, bigint> = {
  FXRP: 0n,
  USDT0: 1n,
  WFLR: 2n,
};

const ONE = 1_000_000_000_000_000_000n; // 1e18 fixed-point scale for USD amounts.

/** Optional overrides carried on the instruction message (defaults are safe). */
export interface BuildPlanParams {
  modelVersion?: bigint;
  codeHash?: Hex;
  nonce?: bigint;
  expiry?: bigint;
  /** Seconds added to now when expiry is not given. Defaults to 1 hour. */
  expiryWindowSecs?: bigint;
  /** Per-venue cap as a fraction of capital. Defaults to optimizer cap (0.30). */
  venueCap?: number;
  /** Reserve floor as a fraction of capital. Defaults to optimizer floor (0.20). */
  reserveFloor?: number;
  /** Fixed "now" for deterministic expiry in tests. */
  nowSecs?: bigint;
}

const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

/** Scale a USD fraction-of-capital weight to an integer 1e18 amount. */
function weightToAmount(weight: number, capital1e18: bigint): bigint {
  if (!Number.isFinite(weight) || weight <= 0) return 0n;
  // 1e12 intermediate precision keeps the float->bigint mapping deterministic.
  const micro = BigInt(Math.round(weight * 1e12));
  return (capital1e18 * micro) / 1_000_000_000_000n;
}

/**
 * Build a deterministic PlanLib.Plan from a market snapshot.
 *
 * Weights come from the AVV optimizer. Each venue amount is clamped to the 30%
 * venue cap; reserveAmount is the residual (capital - deployed) and is floored
 * at 20% of capital; totalOut == capital; sum(allocations)+reserveAmount ==
 * totalOut holds by construction.
 */
export function buildPlan(marketData: MarketData, params: BuildPlanParams = {}): Plan {
  const venueCap = params.venueCap ?? DEFAULT_PARAMS.cap; // 0.30
  const reserveFloor = params.reserveFloor ?? DEFAULT_PARAMS.reserveFloor; // 0.20

  const result = optimize(marketData, { cap: venueCap, reserveFloor });

  const capital1e18 = 1_000_000n * ONE; // 1,000,000 USD notional (matches the client-side demo).
  const capVenueAmount = weightToAmount(venueCap, capital1e18);
  const reserveFloorAmount = weightToAmount(reserveFloor, capital1e18);

  // Map each optimizer venue to an on-chain allocation, canonical order 0,1,2.
  const byVenueId = new Map<bigint, bigint>();
  for (const pv of result.perVenue) {
    const venueId = VENUE_ID_BY_SYMBOL[pv.symbol] ?? BigInt(pv.venueId);
    let amount = weightToAmount(pv.weight, capital1e18);
    if (amount > capVenueAmount) amount = capVenueAmount; // clamp to 30% venue cap
    byVenueId.set(venueId, (byVenueId.get(venueId) ?? 0n) + amount);
  }

  const allocations: Allocation[] = [0n, 1n, 2n].map((venueId) => ({
    venueId,
    amount: byVenueId.get(venueId) ?? 0n,
  }));

  const deployed = allocations.reduce((a, x) => a + x.amount, 0n);
  let reserveAmount = capital1e18 - deployed;
  if (reserveAmount < reserveFloorAmount) reserveAmount = reserveFloorAmount;

  // totalOut is the full capital pulled this cycle; the residual after the
  // (possibly floored) reserve is absorbed by the reserve sink, so totals match.
  const totalOut = deployed + reserveAmount;

  const modelVersion = params.modelVersion ?? 1n;
  const codeHash = params.codeHash ?? ZERO_BYTES32;
  const nonce = params.nonce ?? 0n;
  const now = params.nowSecs ?? BigInt(Math.floor(Date.now() / 1000));
  const expiry = params.expiry ?? now + (params.expiryWindowSecs ?? 3600n);

  // Deterministic planId: keccak256 over the plan's identifying fields. Given a
  // fixed (marketData, modelVersion, codeHash, nonce, expiry) it is stable.
  const planId = keccak256(
    encodeAbiParameters(
      [
        { name: "modelVersion", type: "uint256" },
        { name: "codeHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" },
        { name: "totalOut", type: "uint256" },
        { name: "reserveAmount", type: "uint256" },
        {
          name: "allocations",
          type: "tuple[]",
          components: [
            { name: "venueId", type: "uint256" },
            { name: "amount", type: "uint256" },
          ],
        },
      ] as const,
      [modelVersion, codeHash, nonce, expiry, totalOut, reserveAmount, allocations],
    ),
  );

  return {
    planId,
    modelVersion,
    codeHash,
    nonce,
    expiry,
    totalOut,
    reserveAmount,
    allocations,
  };
}

/** ABI-encode a Plan into the single-tuple layout the frontend decodes. */
export function encodePlan(plan: Plan): Hex {
  return encodeAbiParameters(PLAN_ABI, [plan]);
}

// --- Plan signing (byte-for-byte with demo/schema/preimage.md) ---------------

/**
 * planHash = keccak256(abi.encodePacked(controller, chainId, planId, modelVersion,
 *   codeHash, nonce, expiry, totalOut, reserveAmount, allocHash)) where
 * allocHash = keccak256(abi.encode(allocations)). Domain-separated on the
 * CurationController address + chainId. Must match CurationController.executePlan.
 */
export function computePlanHash(
  controller: Address,
  chainId: bigint,
  plan: Plan,
): Hex {
  const allocHash = keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple[]",
          components: [
            { name: "venueId", type: "uint256" },
            { name: "amount", type: "uint256" },
          ],
        },
      ],
      [plan.allocations],
    ),
  );
  return keccak256(
    encodePacked(
      [
        "address",
        "uint256",
        "bytes32",
        "uint256",
        "bytes32",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
        "bytes32",
      ],
      [
        controller,
        chainId,
        plan.planId,
        plan.modelVersion,
        plan.codeHash,
        plan.nonce,
        plan.expiry,
        plan.totalOut,
        plan.reserveAmount,
        allocHash,
      ],
    ),
  );
}

/** EIP-191 personal_sign of the planHash with the enclave-held TEE key. */
export async function signPlan(
  plan: Plan,
  controller: Address,
  chainId: bigint,
  teeSignerKey: Hex,
): Promise<Hex> {
  const account = privateKeyToAccount(teeSignerKey);
  return account.signMessage({ message: { raw: computePlanHash(controller, chainId, plan) } });
}

// abi.encode(Plan plan, bytes signature): the layout the frontend decodes to
// call CurationController.executePlan(plan, signature).
export const PLAN_WITH_SIG_ABI = [PLAN_ABI[0], { name: "signature", type: "bytes" }] as const;

export function encodePlanWithSig(plan: Plan, signature: Hex): Hex {
  return encodeAbiParameters(PLAN_WITH_SIG_ABI, [plan, signature]);
}

/** Handy for tests/logging: hex-encode a UTF-8 JSON market snapshot. */
export function marketDataToMessageHex(md: MarketData): Hex {
  return toHex(new TextEncoder().encode(JSON.stringify(md)));
}
