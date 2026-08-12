// Plan builder + planHash preimage + EIP-191 sign. Byte-for-byte per preimage.md.
import {
    encodeAbiParameters,
    encodePacked,
    keccak256,
    recoverMessageAddress,
    getAddress,
    type Address,
    type Hex,
} from "viem";
import type {PrivateKeyAccount} from "viem/accounts";
import type {ModelOutput} from "./model.js";

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

// Deterministic planId: keccak of (nonce, deterministic seed). The seed is a
// timestamp-ish value passed in (block/cycle time), so no randomness is used.
export function computePlanId(nonce: bigint, seed: bigint): Hex {
    return keccak256(
        encodePacked(["uint256", "uint256"], [nonce, seed])
    );
}

// allocHash = keccak256(abi.encode(plan.allocations)) — abi.encode (NOT packed)
// for the dynamic array. Matches preimage.md exactly.
export function computeAllocHash(allocations: Allocation[]): Hex {
    return keccak256(
        encodeAbiParameters(
            [
                {
                    type: "tuple[]",
                    components: [
                        {name: "venueId", type: "uint256"},
                        {name: "amount", type: "uint256"},
                    ],
                },
            ],
            [allocations]
        )
    );
}

// planHash = keccak256(abi.encodePacked(controller, chainId, planId, modelVersion,
//   codeHash, nonce, expiry, totalOut, reserveAmount, allocHash)). Per preimage.md.
export function computePlanPreimage(
    controller: Address,
    chainId: number,
    plan: Plan
): Hex {
    const allocHash = computeAllocHash(plan.allocations);
    return encodePacked(
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
            BigInt(chainId),
            plan.planId,
            plan.modelVersion,
            plan.codeHash,
            plan.nonce,
            plan.expiry,
            plan.totalOut,
            plan.reserveAmount,
            allocHash,
        ]
    );
}

export function computePlanHash(
    controller: Address,
    chainId: number,
    plan: Plan
): Hex {
    return keccak256(computePlanPreimage(controller, chainId, plan));
}

// Sign the plan via the REAL TEE node /sign endpoint. The TEE signs
// TextHash(keccak256(message)); we send the preimage bytes, so
// keccak256(preimage) == planHash and the signature verifies in the contract's
// ecrecover(TextHash(planHash)).
export async function teeSignPreimage(
    preimage: Hex,
    teeSignUrl: string
): Promise<Hex> {
    const b64 = Buffer.from(preimage.slice(2), "hex").toString("base64");
    const res = await fetch(teeSignUrl, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({message: b64}),
    });
    if (!res.ok) {
        throw new Error(`TEE sign ${res.status}: ${await res.text()}`);
    }
    const j = (await res.json()) as {signature: string};
    const sig = Buffer.from(j.signature, "base64");
    if (sig.length !== 65) throw new Error(`bad sig length ${sig.length}`);
    if (sig[64] < 27) sig[64] += 27; // normalize v to 27/28
    return ("0x" + sig.toString("hex")) as Hex;
}

// EIP-191 personal_sign over the raw 32-byte planHash.
export async function signPlanHash(
    account: PrivateKeyAccount,
    planHash: Hex
): Promise<Hex> {
    return account.signMessage({message: {raw: planHash}});
}

// Self-test: recovered signer over the sig must equal the expected address.
export async function recoverSigner(
    planHash: Hex,
    signature: Hex
): Promise<Address> {
    return recoverMessageAddress({
        message: {raw: planHash},
        signature,
    });
}

export interface BuildPlanParams {
    controller: Address;
    chainId: number;
    modelVersion: bigint;
    codeHash: Hex;
    nonce: bigint;
    expirySeconds: bigint; // absolute unix seconds
    seed: bigint; // deterministic planId seed
    model: ModelOutput;
}

export function buildPlan(p: BuildPlanParams): Plan {
    const allocations: Allocation[] = p.model.allocations.map((a) => ({
        venueId: BigInt(a.venueId),
        amount: a.amount,
    }));
    return {
        planId: computePlanId(p.nonce, p.seed),
        modelVersion: p.modelVersion,
        codeHash: p.codeHash,
        nonce: p.nonce,
        expiry: p.expirySeconds,
        totalOut: p.model.totalOut,
        reserveAmount: p.model.reserveAmount,
        allocations,
    };
}

export interface SignedPlan {
    plan: Plan;
    planHash: Hex;
    signature: Hex;
    signer: Address;
    recovered: Address;
    recoverOk: boolean;
}

export async function signPlan(
    account: PrivateKeyAccount,
    controller: Address,
    chainId: number,
    plan: Plan
): Promise<SignedPlan> {
    const planHash = computePlanHash(controller, chainId, plan);
    const signature = await signPlanHash(account, planHash);
    const recovered = await recoverSigner(planHash, signature);
    return {
        plan,
        planHash,
        signature,
        signer: getAddress(account.address),
        recovered: getAddress(recovered),
        recoverOk: getAddress(recovered) === getAddress(account.address),
    };
}
