// Bad-plan generators. Each produces an envelope that trips exactly one on-chain
// check, so the frontend "money shot" can show which check killed it.
//
//   overcap        allocation over the venue cap                (-> "over venue cap")
//   badsigner      signed with a different (unregistered) key   (-> "bad signer")
//   badfingerprint wrong codeHash                               (-> "bad fingerprint")
//   replay         reuse a known used planId                    (-> "replay")
//   expired        expiry in the past                           (-> "expired")
import {
    getAddress,
    keccak256,
    toHex,
    type Address,
    type Hex,
    type PublicClient,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {buildAttestation} from "./attestation.js";
import {computeInputHash} from "./commit.js";
import {BIPS_DENOM, CAPITAL_WEI, MODEL} from "./config.js";
import {readInputs} from "./inputs.js";
import {runModel} from "./model.js";
import {
    buildEnvelope,
    readNonce,
    serializePlan,
    type CycleContext,
    type Envelope,
} from "./envelope.js";
import {buildPlan, signPlan, type Plan} from "./sign.js";

export type BadKind =
    | "overcap"
    | "badsigner"
    | "badfingerprint"
    | "replay"
    | "expired";

export const BAD_KINDS: BadKind[] = [
    "overcap",
    "badsigner",
    "badfingerprint",
    "replay",
    "expired",
];

export function isBadKind(s: string): s is BadKind {
    return (BAD_KINDS as string[]).includes(s);
}

// A different private key -> an address that is NOT the registered TEE key.
// Anvil default account #1's key. Deterministic, unregistered.
const UNREGISTERED_KEY =
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;

// A stable "known used" planId for the replay case. Deterministic constant.
export const KNOWN_USED_PLAN_ID: Hex = keccak256(toHex("demo-used-plan-id"));

export async function buildBadEnvelope(
    client: PublicClient,
    ctx: CycleContext,
    kind: BadKind,
    nowSeconds: bigint
): Promise<Envelope> {
    const inputs = await readInputs(client, ctx.addresses);
    const inputHash = computeInputHash(inputs);
    const model = runModel(inputs, nowSeconds);
    const nonce = await readNonce(client, ctx.controller);
    const seed = inputs.chainConnected ? inputs.blockNumber : nowSeconds;

    // Start from an otherwise-valid plan, then corrupt exactly one field.
    let codeHash = ctx.codeHash;
    let expiry = nowSeconds + 300n;
    let signerAccount = ctx.account;

    const base = buildPlan({
        controller: ctx.controller,
        chainId: ctx.chainId,
        modelVersion: ctx.modelVersion,
        codeHash,
        nonce,
        expirySeconds: expiry,
        seed,
        model,
    });

    let plan: Plan = base;

    switch (kind) {
        case "overcap": {
            // Inflate one allocation to ~40% of capital, over the 30% venue cap
            // (venueCapBips 3000). On-chain this trips "over venue cap". If the
            // (defensive) model produced no allocations, synthesise one for FXRP.
            const venueCap = (CAPITAL_WEI * MODEL.VENUE_CAP_BIPS) / BIPS_DENOM;
            const over = (CAPITAL_WEI * 4000n) / BIPS_DENOM; // 40% of capital
            void venueCap;
            const allocations =
                base.allocations.length > 0
                    ? base.allocations.map((a, i) =>
                          i === 0 ? {venueId: a.venueId, amount: over} : a
                      )
                    : [{venueId: 0n, amount: over}];
            const deployed = allocations.reduce((s, a) => s + a.amount, 0n);
            plan = {
                ...base,
                allocations,
                totalOut: deployed + base.reserveAmount,
            };
            break;
        }
        case "badsigner": {
            signerAccount = privateKeyToAccount(UNREGISTERED_KEY);
            break;
        }
        case "badfingerprint": {
            // Wrong codeHash -> not a supported (version, codeHash) tuple.
            codeHash = keccak256(toHex("wrong-code-hash")) as Hex;
            plan = {...base, codeHash};
            break;
        }
        case "replay": {
            // Reuse a known-used planId.
            plan = {...base, planId: KNOWN_USED_PLAN_ID};
            break;
        }
        case "expired": {
            expiry = nowSeconds - 1n; // already in the past
            plan = {...base, expiry};
            break;
        }
    }

    const signed = await signPlan(
        signerAccount,
        ctx.controller,
        ctx.chainId,
        plan
    );
    const attestation = buildAttestation(codeHash);

    // Reuse the envelope assembler, but re-serialize the (possibly corrupted)
    // plan directly so codeHash/allocations/expiry corruption is reflected.
    const env = buildEnvelope(
        signed,
        inputHash,
        model.reasonCodes,
        inputs,
        model,
        ctx.modelVersion,
        attestation
    );
    env.plan = serializePlan(plan, ctx.modelVersion);
    return env;
}

// Expose the unregistered signer address (for logging / tests).
export function unregisteredSignerAddress(): Address {
    return getAddress(privateKeyToAccount(UNREGISTERED_KEY).address);
}
