// Curation model: the REAL Mystic allocation optimizer, run inside the (simulated)
// TEE over authenticated inputs.
//
// Each cycle the model (1) takes the authenticated inputs (the live Mystic market
// snapshot per venue plus the FTSO FLR/USD and XRP/USD reads), (2) runs the quant
// worker's optimizer (optimizer/optimize.ts: maximize risk-adjusted supply yield
// by water-filling subject to per-venue cap, total-out cap, reserve floor and
// per-venue liquidity caps), and (3) maps the resulting weights to a bounded Plan
// in USD 1e18 fixed point.
//
// Admission gates still apply: staleness (FTSO timestamp too old) and depeg (per
// -venue knob). If a gate trips, everything is routed to reserve (defensive sink),
// so no funds reach a stressed venue.
//
// Accounting unit is USD in 1e18 fixed point. Capital C default = 1,000,000 USD =
// CAPITAL_WEI. allocations[i].amount = round(C_wei * weight_i); reserveAmount =
// C_wei - sum(allocations) (so sum(allocations)+reserveAmount == totalOut exactly
// and the on-chain "totals mismatch" check passes). totalOut = C_wei here (the
// whole book is placed: deployed venues + reserve), matching preimage.md's
// "totalOut = sum(allocations) + reserveAmount".
import {
    BIPS_DENOM,
    CAPITAL_USD,
    CAPITAL_WEI,
    MODEL,
    USD_1E18,
} from "./config.js";
import type {Inputs, VenueState} from "./inputs.js";
import {
    optimize,
    type MarketData,
    type OptimizeResult,
} from "../../optimizer/optimize.js";

export interface ReasonCode {
    venueId: number;
    eligible: boolean;
    reason: string;
}

export interface ModelOutput {
    // Per-venue target amounts (USD 1e18). Index-aligned with the allocations we emit.
    allocations: {venueId: number; amount: bigint}[];
    reserveAmount: bigint;
    totalOut: bigint;
    reasonCodes: ReasonCode[];
    // Gate results for display.
    stale: boolean;
    depeg: boolean;
    fresh: boolean;
    defensive: boolean;
    // Optimizer diagnostics echoed for the UI (not part of the signed preimage).
    expectedApy?: number;
    expectedRiskAdjApy?: number;
    rationale?: string;
}

// Round a float USD amount to USD 1e18 (nearest integer wei). Non-negative.
function usdToWei(usd: number): bigint {
    if (!isFinite(usd) || usd <= 0) return 0n;
    // Scale with enough precision then convert. 1e6 sub-cent precision on USD.
    const micros = BigInt(Math.round(usd * 1e6));
    return (micros * USD_1E18) / 1_000_000n;
}

// "now" is injected so the model stays a pure function (deterministic under test).
export function runModel(inputs: Inputs, nowSeconds: bigint): ModelOutput {
    const capWei = CAPITAL_WEI;
    const venueCap = (capWei * MODEL.VENUE_CAP_BIPS) / BIPS_DENOM;
    const reserveFloor = (capWei * MODEL.MIN_RESERVE_BIPS) / BIPS_DENOM;

    // Admission gate: staleness. Guard against clock skew (future timestamp).
    const age =
        nowSeconds > inputs.feed.timestamp
            ? nowSeconds - inputs.feed.timestamp
            : 0n;
    const stale = age > MODEL.MAX_STALENESS_SECONDS;

    // Admission gate: depeg (per-venue demo knob).
    const depeg = inputs.venues.some((v) => v.depeg);
    const fresh = !stale;

    // Per-venue eligibility (for the UI). The optimizer enforces the hard caps.
    const reasonCodes: ReasonCode[] = [];
    const eligibleIds = new Set<number>();
    for (const v of inputs.venues) {
        let reason = "eligible";
        let ok = true;
        if (stale) {
            ok = false;
            reason = "input stale";
        } else if (v.depeg) {
            ok = false;
            reason = "venue depeg";
        } else if (v.utilisationBips > MODEL.MAX_UTIL_BIPS) {
            ok = false;
            reason = "utilisation over max";
        } else if (v.availableLiquidity < MODEL.MIN_LIQUIDITY) {
            ok = false;
            reason = "insufficient liquidity";
        }
        reasonCodes.push({venueId: v.venueId, eligible: ok, reason});
        if (ok) eligibleIds.add(v.venueId);
    }

    // Defensive routing: admission gate tripped or nothing eligible.
    const defensive = stale || depeg || eligibleIds.size === 0;
    if (defensive) {
        // Park the whole book in reserve; no venue allocations. totalOut == C.
        const reserveAmount = capWei;
        return {
            allocations: [],
            reserveAmount,
            totalOut: reserveAmount,
            reasonCodes,
            stale,
            depeg,
            fresh,
            defensive: true,
        };
    }

    // Run the REAL optimizer over the authenticated Mystic market snapshot.
    // Params are pinned to the on-chain limits so a good plan always passes the
    // controller's cap/reserve checks:
    //   cap 0.3 == venueCapBips 3000, maxTotalOut 0.8, reserveFloor 0.2.
    const result: OptimizeResult = optimize(inputs.marketData, {
        capital: Number(CAPITAL_USD),
        cap: Number(MODEL.VENUE_CAP_BIPS) / Number(BIPS_DENOM),
        maxTotalOut: Number(MODEL.MAX_TOTAL_OUT_BIPS) / Number(BIPS_DENOM),
        reserveFloor: Number(MODEL.MIN_RESERVE_BIPS) / Number(BIPS_DENOM),
    });

    // Map optimizer weights (fractions of C) to USD-1e18 allocations. Emit only
    // venues that are eligible and get a non-zero weight, ordered by venueId.
    const perVenue = [...result.perVenue].sort((a, b) => a.venueId - b.venueId);
    const allocations: {venueId: number; amount: bigint}[] = [];
    let deployed = 0n;
    for (const pv of perVenue) {
        if (!eligibleIds.has(pv.venueId)) continue;
        let amount = usdToWei(pv.amountUsd);
        if (amount <= 0n) continue;
        // Defense in depth: never exceed the on-chain venue cap even if the
        // optimizer float rounding pushed a hair over.
        if (amount > venueCap) amount = venueCap;
        allocations.push({venueId: pv.venueId, amount});
        deployed += amount;
    }

    // Reserve = whole book minus what was deployed, so totals reconcile exactly
    // and reserve is always >= floor (optimizer keeps deployed <= 1 - reserveFloor).
    let reserveAmount = capWei > deployed ? capWei - deployed : 0n;
    if (reserveAmount < reserveFloor) {
        // Should not happen given maxTotalOut 0.8, but keep the floor hard.
        reserveAmount = reserveFloor;
    }

    const totalOut = deployed + reserveAmount;

    return {
        allocations,
        reserveAmount,
        totalOut,
        reasonCodes,
        stale,
        depeg,
        fresh,
        defensive: false,
        expectedApy: result.expectedApy,
        expectedRiskAdjApy: result.expectedRiskAdjApy,
        rationale: result.rationale,
    };
}

// Re-export the market-data type for callers that assemble Inputs.
export type {MarketData};
