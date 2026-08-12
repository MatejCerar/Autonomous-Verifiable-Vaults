// SIMULATED attestation blob, exactly per plan.schema.json. Only the hardware
// root of trust is stubbed; the signature and codeHash are real.
import type {Hex} from "viem";

export const ATTESTATION_NOTE =
    "Attestation is simulated for this PoC. Swap the signer for a tee-node " +
    "enclave for real attestation; contracts are unchanged.";

export interface Attestation {
    kind: "simulated-confidential-space";
    jwt: string;
    claims: {
        image_digest: string;
        hwmodel: string;
        platform: string;
    };
    note: string;
}

// image_digest = codeHash WITHOUT the 0x prefix (mirrors tee-node stripping the
// "sha256:" prefix from the Confidential Space image digest to derive CodeHash).
export function buildAttestation(codeHash: Hex): Attestation {
    const imageDigest = codeHash.startsWith("0x")
        ? codeHash.slice(2)
        : codeHash;

    // Deterministic stub JWT: fixed header + a claims payload derived from the
    // codeHash. base64url, no signature segment content (stub, not verified).
    const header = base64url(
        JSON.stringify({alg: "none", typ: "JWT", kid: "simulated"})
    );
    const payload = base64url(
        JSON.stringify({
            iss: "https://confidentialcomputing.googleapis.com",
            sub: "simulated-tee-model",
            hwmodel: "simulated",
            image_digest: imageDigest,
            platform: "simulated",
        })
    );
    const jwt = `${header}.${payload}.stub-not-hardware-verified`;

    return {
        kind: "simulated-confidential-space",
        jwt,
        claims: {
            image_digest: imageDigest,
            hwmodel: "simulated",
            platform: "simulated",
        },
        note: ATTESTATION_NOTE,
    };
}

function base64url(s: string): string {
    return Buffer.from(s, "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}
