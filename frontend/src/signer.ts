// Plan-hash preimage + signer recovery, byte-for-byte per ../../schema/preimage.md
// and contracts/src/libraries/PlanLib.sol. The browser reproduces the exact hash
// the CurationController recovers against, so the "bad signer" check can be shown
// off-chain identically to the on-chain ecrecover.
//
// No emojis, no em dashes in this file (house style).
import {
  encodeAbiParameters,
  encodePacked,
  keccak256,
  recoverMessageAddress,
  getAddress,
  type Hex,
} from "viem";
import type { Envelope } from "@/data";
import { addresses } from "@/addresses";

// Domain separation: controller address + chainId. Offline (no live controller)
// the sample envelopes are signed against addresses.json's deployed controller
// (empty -> zero address) and chainId, exactly as tee-model does. We mirror that
// so recovery matches.
const ZERO = "0x0000000000000000000000000000000000000000" as Hex;

function controllerAddress(): Hex {
  const c = addresses.curationController;
  return c && c !== "" ? (getAddress(c) as Hex) : ZERO;
}

/** keccak256(abi.encode(allocations)) - the dynamic array is pre-hashed. */
function allocHash(env: Envelope): Hex {
  return keccak256(
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
      [
        env.plan.allocations.map((a) => ({
          venueId: BigInt(a.venueId),
          amount: BigInt(a.amount),
        })),
      ],
    ),
  );
}

/** The domain-separated planHash (the raw 32 bytes the TEE personal-signs). */
export function computePlanHash(env: Envelope): Hex {
  const p = env.plan;
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
        controllerAddress(),
        BigInt(addresses.chainId),
        p.planId as Hex,
        BigInt(p.modelVersion),
        p.codeHash as Hex,
        BigInt(p.nonce),
        BigInt(p.expiry),
        BigInt(p.totalOut),
        BigInt(p.reserveAmount),
        allocHash(env),
      ],
    ),
  );
}

/** Recover the enclave address that signed this envelope's plan. */
export async function recoverPlanSigner(env: Envelope): Promise<Hex> {
  const planHash = computePlanHash(env);
  const rec = await recoverMessageAddress({
    message: { raw: planHash },
    signature: env.signature as Hex,
  });
  return getAddress(rec) as Hex;
}
