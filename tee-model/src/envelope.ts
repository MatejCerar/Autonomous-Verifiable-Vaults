// Assemble the schema-conformant Plan+attestation wire envelope, and drive a
// full cycle (read inputs -> commit -> model -> build+sign plan -> attest).
import {getAddress, keccak256, type Address, type Hex, type PublicClient} from "viem";
import type {PrivateKeyAccount} from "viem/accounts";
import {buildAttestation, type Attestation} from "./attestation.js";
import {computeInputHash} from "./commit.js";
import {controllerAbi} from "./abis.js";
import {getTeeSignUrl, loadAddresses, type Addresses} from "./config.js";
import {readInputs, type Inputs} from "./inputs.js";
import {runModel, type ModelOutput, type ReasonCode} from "./model.js";
import {computeCodeHash} from "./measure.js";
import {
    buildPlan,
    computePlanPreimage,
    recoverSigner,
    signPlan,
    teeSignPreimage,
    type Plan,
    type SignedPlan,
} from "./sign.js";

// The wire envelope, matching plan.schema.json exactly (all numeric fields as
// decimal strings, planId/codeHash as 0x-hex).
export interface Envelope {
    plan: {
        planId: Hex;
        modelVersion: string;
        codeHash: Hex;
        nonce: string;
        expiry: string;
        totalOut: string;
        reserveAmount: string;
        allocations: {venueId: string; amount: string}[];
    };
    signature: Hex;
    inputHash: Hex;
    reasonCodes: {venueId: string; eligible: boolean; reason: string}[];
    inputs: {
        flrUsdValue: string;
        flrUsdDecimals: number;
        flrUsdTimestamp: string;
        xrpUsdValue: string;
        xrpUsdDecimals: number;
        xrpUsdTimestamp: string;
        marketAsOf: string;
        fresh: boolean;
        depeg: boolean;
    };
    attestation: Attestation;
}

export interface CycleContext {
    addresses: Addresses;
    account: PrivateKeyAccount;
    codeHash: Hex;
    controller: Address;
    chainId: number;
    modelVersion: bigint;
}

export function serializePlan(plan: Plan, modelVersion: bigint): Envelope["plan"] {
    return {
        planId: plan.planId,
        modelVersion: modelVersion.toString(),
        codeHash: plan.codeHash,
        nonce: plan.nonce.toString(),
        expiry: plan.expiry.toString(),
        totalOut: plan.totalOut.toString(),
        reserveAmount: plan.reserveAmount.toString(),
        allocations: plan.allocations.map((a) => ({
            venueId: a.venueId.toString(),
            amount: a.amount.toString(),
        })),
    };
}

export function buildEnvelope(
    signed: SignedPlan,
    inputHash: Hex,
    reasonCodes: ReasonCode[],
    inputs: Inputs,
    model: ModelOutput,
    modelVersion: bigint,
    attestation: Attestation
): Envelope {
    return {
        plan: serializePlan(signed.plan, modelVersion),
        signature: signed.signature,
        inputHash,
        reasonCodes: reasonCodes.map((r) => ({
            venueId: r.venueId.toString(),
            eligible: r.eligible,
            reason: r.reason,
        })),
        inputs: {
            flrUsdValue: inputs.feed.value.toString(),
            flrUsdDecimals: inputs.feed.decimals,
            flrUsdTimestamp: inputs.feed.timestamp.toString(),
            xrpUsdValue: inputs.xrpFeed.value.toString(),
            xrpUsdDecimals: inputs.xrpFeed.decimals,
            xrpUsdTimestamp: inputs.xrpFeed.timestamp.toString(),
            marketAsOf: inputs.marketAsOf,
            fresh: model.fresh,
            depeg: model.depeg,
        },
        attestation,
    };
}

// Read the controller nonce on-chain; fall back to 0 if unavailable (offline /
// not deployed). Never hard-blocks.
export async function readNonce(
    client: PublicClient,
    controller: Address
): Promise<bigint> {
    try {
        if (
            controller === "0x0000000000000000000000000000000000000000"
        ) {
            return 0n;
        }
        return (await client.readContract({
            address: controller,
            abi: controllerAbi(),
            functionName: "nonce",
        })) as bigint;
    } catch {
        return 0n;
    }
}

export interface CycleResult {
    envelope: Envelope;
    signed: SignedPlan;
    inputs: Inputs;
    model: ModelOutput;
    planHash: Hex;
    recoverOk: boolean;
}

// Full cycle producing a VALID envelope. `nowSeconds` injected for determinism.
export async function runCycle(
    client: PublicClient,
    ctx: CycleContext,
    nowSeconds: bigint
): Promise<CycleResult> {
    const inputs = await readInputs(client, ctx.addresses);
    const inputHash = computeInputHash(inputs);
    const model = runModel(inputs, nowSeconds);

    const nonce = await readNonce(client, ctx.controller);
    // Deterministic seed = block number when connected, else the injected time.
    const seed = inputs.chainConnected ? inputs.blockNumber : nowSeconds;

    const plan = buildPlan({
        controller: ctx.controller,
        chainId: ctx.chainId,
        modelVersion: ctx.modelVersion,
        codeHash: ctx.codeHash,
        nonce,
        expirySeconds: nowSeconds + 300n,
        seed,
        model,
    });

    const teeSignUrl = getTeeSignUrl();
    let signed: SignedPlan;
    if (teeSignUrl) {
        // Sign the plan with the REAL TEE node instead of the local key.
        const preimage = computePlanPreimage(ctx.controller, ctx.chainId, plan);
        const planHash = keccak256(preimage);
        const signature = await teeSignPreimage(preimage, teeSignUrl);
        const recovered = getAddress(await recoverSigner(planHash, signature));
        const teeAddr = (ctx.addresses as {teeSignerAddress?: string})
            .teeSignerAddress;
        const expected = teeAddr ? getAddress(teeAddr as Address) : recovered;
        signed = {
            plan,
            planHash,
            signature,
            signer: recovered,
            recovered,
            recoverOk: recovered === expected,
        };
    } else {
        signed = await signPlan(
            ctx.account,
            ctx.controller,
            ctx.chainId,
            plan
        );
    }
    const attestation = buildAttestation(ctx.codeHash);
    const envelope = buildEnvelope(
        signed,
        inputHash,
        model.reasonCodes,
        inputs,
        model,
        ctx.modelVersion,
        attestation
    );

    return {
        envelope,
        signed,
        inputs,
        model,
        planHash: signed.planHash,
        recoverOk: signed.recoverOk,
    };
}

// Build the cycle context from addresses.json + env. Controller address falls
// back to the zero address (offline self-test) if not yet deployed.
export function buildContext(
    account: PrivateKeyAccount,
    addresses: Addresses
): CycleContext {
    const deployed = addresses.deployed.curationController;
    const controller =
        deployed && deployed !== ""
            ? getAddress(deployed)
            : ("0x0000000000000000000000000000000000000000" as Address);
    return {
        addresses,
        account,
        codeHash: computeCodeHash(),
        controller,
        chainId: addresses.chainId,
        modelVersion: BigInt(addresses.modelVersion),
    };
}

export {loadAddresses};
