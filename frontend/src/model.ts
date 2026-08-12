import { z } from "zod";
import { MODEL_URL } from "@/chain";

// Zod mirror of schema/plan.schema.json (FROZEN envelope).
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const uintStr = z.string(); // uint256 as decimal string
const sig = z.string().regex(/^0x[0-9a-fA-F]{130}$/);

export const allocationSchema = z.object({
  venueId: uintStr,
  amount: uintStr,
});

export const planSchema = z.object({
  planId: hex32,
  modelVersion: uintStr,
  codeHash: hex32,
  nonce: uintStr,
  expiry: uintStr,
  totalOut: uintStr,
  reserveAmount: uintStr,
  allocations: z.array(allocationSchema),
});

export const reasonCodeSchema = z.object({
  venueId: z.string().optional(),
  eligible: z.boolean().optional(),
  reason: z.string().optional(),
});

export const inputsSchema = z.object({
  flrUsdValue: z.string().optional(),
  flrUsdDecimals: z.number().int().optional(),
  flrUsdTimestamp: z.string().optional(),
  fresh: z.boolean().optional(),
  depeg: z.boolean().optional(),
});

export const attestationSchema = z.object({
  kind: z.string(),
  jwt: z.string().optional(),
  claims: z
    .object({
      image_digest: z.string().optional(),
      hwmodel: z.string().optional(),
      platform: z.string().optional(),
    })
    .optional(),
  note: z.string(),
});

export const envelopeSchema = z.object({
  plan: planSchema,
  signature: sig,
  inputHash: hex32,
  reasonCodes: z.array(reasonCodeSchema).optional(),
  inputs: inputsSchema.optional(),
  attestation: attestationSchema,
});

export type Allocation = z.infer<typeof allocationSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Envelope = z.infer<typeof envelopeSchema>;
export type ModelInputs = z.infer<typeof inputsSchema>;

// The /inputs endpoint returns the authenticated FTSO read. It may be the raw
// inputs object or wrapped in { inputs }. Accept both, validate the inner shape.
export const inputsResponseSchema = z.union([
  inputsSchema,
  z.object({ inputs: inputsSchema }),
]);

export type BadKind =
  | "overcap"
  | "badsigner"
  | "badfingerprint"
  | "replay"
  | "expired";

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`model service ${res.status} ${res.statusText} (${url})`);
  }
  return res.json();
}

export async function fetchInputs(): Promise<ModelInputs> {
  const raw = await getJson(`${MODEL_URL}/inputs`);
  const parsed = inputsResponseSchema.parse(raw);
  return "inputs" in parsed ? parsed.inputs : parsed;
}

export async function fetchCycle(bad?: BadKind): Promise<Envelope> {
  const url = bad
    ? `${MODEL_URL}/cycle?bad=${encodeURIComponent(bad)}`
    : `${MODEL_URL}/cycle`;
  const raw = await getJson(url);
  return envelopeSchema.parse(raw);
}
