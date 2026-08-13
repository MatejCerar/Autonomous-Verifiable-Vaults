// Runtime data loader. All demo data is produced by other workers and copied
// into public/data by sync-data.mjs; the app fetches it from /data/*.json at
// runtime (works under vite dev and the built bundle).
//
// No emojis, no em dashes in this file (house style).
import { z } from "zod";

// --------------------------------------------------------------------------
// market-data.json (research)
// --------------------------------------------------------------------------
const priceSchema = z.object({
  value: z.number(),
  source: z.string(),
  confidence: z.string(),
});

const assetSchema = z.object({
  symbol: z.string(),
  tokenSymbol: z.string(),
  token: z.string(),
  decimals: z.number(),
  vault: z.string(),
  vaultName: z.string(),
  supplyApy: z.number(),
  supplyApyOnchainComputed: z.number().optional(),
  utilization: z.number(),
  availableLiquidityUsd: z.number(),
  availableLiquidityNote: z.string().optional(),
  tvlUsd: z.number(),
  lltv: z.number(),
  lltvNote: z.string().optional(),
  priceUsd: z.number(),
  annualizedVol: z.number(),
});

export const marketDataSchema = z.object({
  asOf: z.string(),
  chainId: z.number(),
  chainName: z.string(),
  protocol: z.string(),
  app: z.string().optional(),
  note: z.string().optional(),
  prices: z.object({
    FLR_USD: priceSchema,
    XRP_USD: priceSchema,
    USDT0_USD: priceSchema,
  }),
  assets: z.array(assetSchema),
  irm: z
    .object({
      type: z.string(),
      targetUtilization: z.number(),
      curveSteepness: z.number(),
      shape: z.string().optional(),
    })
    .optional(),
  pairwiseCorrelation: z
    .object({
      order: z.array(z.string()),
      matrix: z.array(z.array(z.number())),
    })
    .optional(),
});
export type MarketData = z.infer<typeof marketDataSchema>;
export type MarketAsset = z.infer<typeof assetSchema>;

// --------------------------------------------------------------------------
// result.json (optimizer)
// --------------------------------------------------------------------------
const perVenueSchema = z.object({
  symbol: z.string(),
  venueId: z.number(),
  weight: z.number(),
  amountUsd: z.number(),
  tokenAmount: z.number(),
  decimals: z.number(),
  supplyApyPostDeposit: z.number(),
  marginalYield: z.number(),
  bindingConstraint: z.string(),
});

export const optimizerResultSchema = z.object({
  asOf: z.string(),
  chainId: z.number(),
  capital: z.number(),
  params: z.object({
    cap: z.number(),
    maxTotalOut: z.number(),
    reserveFloor: z.number(),
    lambda: z.number(),
    reserveApy: z.number(),
    uTarget: z.number(),
    curveSteepness: z.number(),
  }),
  weights: z.record(z.string(), z.number()),
  reserve: z.number(),
  expectedApy: z.number(),
  expectedRiskAdjApy: z.number(),
  perVenue: z.array(perVenueSchema),
  waterLine: z.number().optional(),
  rationale: z.string(),
});
export type OptimizerResult = z.infer<typeof optimizerResultSchema>;
export type OptimizerVenue = z.infer<typeof perVenueSchema>;

// --------------------------------------------------------------------------
// envelope.json / envelope-bad.json (tee-model)
// --------------------------------------------------------------------------
const hex = z.string();
const allocationSchema = z.object({
  venueId: z.string(),
  amount: z.string(),
});
export const planSchema = z.object({
  planId: hex,
  modelVersion: z.string(),
  codeHash: hex,
  nonce: z.string(),
  expiry: z.string(),
  totalOut: z.string(),
  reserveAmount: z.string(),
  allocations: z.array(allocationSchema),
});
export const envelopeSchema = z.object({
  plan: planSchema,
  signature: hex,
  inputHash: hex,
  reasonCodes: z
    .array(
      z.object({
        venueId: z.string().optional(),
        eligible: z.boolean().optional(),
        reason: z.string().optional(),
      }),
    )
    .optional(),
  inputs: z
    .object({
      flrUsdValue: z.string().optional(),
      flrUsdDecimals: z.number().optional(),
      flrUsdTimestamp: z.string().optional(),
      xrpUsdValue: z.string().optional(),
      xrpUsdDecimals: z.number().optional(),
      xrpUsdTimestamp: z.string().optional(),
      marketAsOf: z.string().optional(),
      fresh: z.boolean().optional(),
      depeg: z.boolean().optional(),
    })
    .optional(),
  attestation: z.object({
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
  }),
});
export type Plan = z.infer<typeof planSchema>;
export type Allocation = z.infer<typeof allocationSchema>;
export type Envelope = z.infer<typeof envelopeSchema>;

// --------------------------------------------------------------------------
// prepared-bundle.json (prepared-txs)
// --------------------------------------------------------------------------
const preparedTxSchema = z.object({
  label: z.string(),
  venueId: z.number(),
  symbol: z.string(),
  chainId: z.number(),
  from: z.string(),
  to: z.string(),
  value: z.string(),
  data: z.string(),
  decoded: z.object({
    fn: z.string(),
    args: z.record(z.string(), z.string()),
  }),
  gasLimitSuggestion: z.string().optional(),
});
export type PreparedTx = z.infer<typeof preparedTxSchema>;

const tokenAmountSchema = z.object({
  venueId: z.number(),
  weight: z.number(),
  amountUsd: z.number(),
  priceUsd: z.number(),
  decimals: z.number(),
  tokenAmount: z.string(),
});

export const preparedBundleSchema = z.object({
  header: z.object({
    asOf: z.string(),
    builtAt: z.string(),
    chainId: z.number(),
    chainName: z.string(),
    capitalUsd: z.number(),
    receiver: z.string(),
    receiverNote: z.string().optional(),
    note: z.string(),
    reserveFraction: z.number(),
    reserveUsdUndeployed: z.number(),
    tokenAmounts: z.record(z.string(), tokenAmountSchema),
    conventions: z
      .object({
        venueIds: z.record(z.string(), z.string()),
        approveSelector: z.string(),
        depositSelector: z.string(),
        ordering: z.string(),
      })
      .optional(),
    swapPrerequisite: z.string().optional(),
  }),
  transactions: z.array(preparedTxSchema),
});
export type PreparedBundle = z.infer<typeof preparedBundleSchema>;

// --------------------------------------------------------------------------
// fetch helpers
// --------------------------------------------------------------------------
async function getJson(path: string): Promise<unknown> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`failed to load ${path}: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function loadMarketData(): Promise<MarketData> {
  return marketDataSchema.parse(await getJson("/data/market-data.json"));
}
export async function loadOptimizerResult(): Promise<OptimizerResult> {
  return optimizerResultSchema.parse(await getJson("/data/result.json"));
}
export async function loadEnvelope(): Promise<Envelope> {
  return envelopeSchema.parse(await getJson("/data/envelope.json"));
}
export async function loadEnvelopeBad(): Promise<Envelope> {
  return envelopeSchema.parse(await getJson("/data/envelope-bad.json"));
}
export async function loadPreparedBundle(): Promise<PreparedBundle> {
  return preparedBundleSchema.parse(await getJson("/data/prepared-bundle.json"));
}

export interface DemoData {
  market: MarketData;
  optimizer: OptimizerResult;
  envelope: Envelope;
  envelopeBad: Envelope;
  bundle: PreparedBundle;
}

export async function loadAll(): Promise<DemoData> {
  const [market, optimizer, envelope, envelopeBad, bundle] = await Promise.all([
    loadMarketData(),
    loadOptimizerResult(),
    loadEnvelope(),
    loadEnvelopeBad(),
    loadPreparedBundle(),
  ]);
  return { market, optimizer, envelope, envelopeBad, bundle };
}
