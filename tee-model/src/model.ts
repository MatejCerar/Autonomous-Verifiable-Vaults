// Deterministic curation model. Pure function of inputs, no randomness.
//
// Admission gates: staleness (FTSO timestamp too old) and depeg (per-venue knob
// or price outside the depeg band). Per-venue eligibility: utilisation <= maxUtil
// AND liquidity >= minLiquidity AND not stale AND not depeg. Scoring: inverse-
// utilisation weight across eligible venues, each clamped to the venue cap (so a
// good plan always passes the on-chain cap check); remainder + the mandatory
// reserve floor go to reserve. Defensive routing: if a gate trips or nothing is
// eligible, route everything to reserve.
import {BIPS_DENOM, MODEL} from "./config.js";
import type {Inputs, VenueState} from "./inputs.js";

export interface ReasonCode {
    venueId: number;
    eligible: boolean;
    reason: string;
}

export interface ModelOutput {
    // Per-venue target amounts (wei). Index-aligned with allocations we emit.
    allocations: {venueId: number; amount: bigint}[];
    reserveAmount: bigint;
    totalOut: bigint;
    reasonCodes: ReasonCode[];
    // Gate results for display.
    stale: boolean;
    depeg: boolean;
    fresh: boolean; // !stale && !oracleFallback-independent (freshness of the feed)
    defensive: boolean;
}

// "now" is injected so the model stays a pure function (deterministic under test).
export function runModel(inputs: Inputs, nowSeconds: bigint): ModelOutput {
    const tvl = inputs.tvl;
    const venueCap = (tvl * MODEL.VENUE_CAP_BIPS) / BIPS_DENOM;
    const reserveFloor = (tvl * MODEL.MIN_RESERVE_BIPS) / BIPS_DENOM;
    const targetDeploy = (tvl * MODEL.TARGET_DEPLOY_BIPS) / BIPS_DENOM;

    // Admission gate: staleness. Guard against clock skew (future timestamp).
    const age =
        nowSeconds > inputs.feed.timestamp
            ? nowSeconds - inputs.feed.timestamp
            : 0n;
    const stale = age > MODEL.MAX_STALENESS_SECONDS;

    // Admission gate: depeg. Driven by a per-venue depeg knob (a demo signal),
    // not by the FLR/USD display feed (which is not the vault's stablecoin). The
    // FTSO read still drives the real staleness check above and is shown as the
    // authenticated input.
    const depeg = inputs.venues.some((v) => v.depeg);

    const fresh = !stale;

    // Per-venue eligibility.
    const reasonCodes: ReasonCode[] = [];
    const eligible: VenueState[] = [];
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
        if (ok) eligible.push(v);
    }

    // Defensive routing: admission gate tripped or nothing eligible.
    const defensive = stale || depeg || eligible.length === 0;
    if (defensive) {
        // Everything to reserve, no venue allocations. totalOut == reserve.
        // Reserve at least the floor; in defensive mode we park the target too.
        const reserveAmount =
            targetDeploy > reserveFloor ? targetDeploy : reserveFloor;
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

    // Scoring: inverse-utilisation weight. weight_i = (BIPS_DENOM - util_i).
    // Use bips so weights are integers and deterministic. Guard zero-sum.
    const weights = eligible.map((v) => {
        const w = BIPS_DENOM - v.utilisationBips;
        return w > 0n ? w : 1n;
    });
    const weightSum = weights.reduce((a, b) => a + b, 0n);

    // Size allocations to targetDeploy, split by weight, clamp each to venueCap.
    const allocations: {venueId: number; amount: bigint}[] = [];
    let deployed = 0n;
    for (let i = 0; i < eligible.length; i++) {
        let amount = (targetDeploy * weights[i]) / weightSum;
        if (amount > venueCap) amount = venueCap; // clamp to on-chain cap
        allocations.push({venueId: eligible[i].venueId, amount});
        deployed += amount;
    }

    // Remainder (target not deployed due to clamps) + mandatory reserve floor
    // go to reserve. Reserve is always >= floor.
    const remainder = targetDeploy > deployed ? targetDeploy - deployed : 0n;
    let reserveAmount = reserveFloor + remainder;
    if (reserveAmount < reserveFloor) reserveAmount = reserveFloor;

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
    };
}
