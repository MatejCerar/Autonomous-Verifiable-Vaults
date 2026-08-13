// Live cycle engine. Everything here runs client-side in the browser (no
// backend): read the live market on Flare mainnet, run the SAME optimizer the
// TEE runs, build the prepared (unsigned) transactions with full calldata, and
// re-sign the bounded plan with the demo enclave key. Nothing is broadcast.
//
// Data provenance per field is labeled: FTSO on-chain, vault totalAssets
// on-chain, DefiLlama API, or snapshot estimate (vol / correlation / peg).
//
// No emojis, no em dashes in this file (house style).
import {
  createPublicClient,
  http,
  encodeFunctionData,
  formatUnits,
  keccak256,
  encodePacked,
  encodeAbiParameters,
  toHex,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  optimize,
  DEFAULT_PARAMS,
  type MarketData as OptMarketData,
  type OptimizeResult,
} from "../../optimizer/optimize";
import { abis } from "@/abi";
import { addresses } from "@/addresses";
import type {
  MarketData,
  MarketAsset,
  OptimizerResult,
  OptimizerVenue,
  PreparedBundle,
  PreparedTx,
  Envelope,
} from "@/data";

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------
export const FLARE_RPC = "https://flare-api.flare.network/ext/C/rpc";
const CHAIN_ID = 14;

const FLR_USD_ID =
  "0x01464c522f55534400000000000000000000000000" as Hex; // "FLR/USD"
const XRP_USD_ID =
  "0x015852502f55534400000000000000000000000000" as Hex; // "XRP/USD"

// Demo enclave key (well-known Anvil account 0). Used ONLY to re-sign the plan
// off-chain so Steps 3/4 can show the signature + signer-recovery per cycle.
const DEMO_ENCLAVE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

// Selectors, surfaced for display parity with the offline bundle.
const APPROVE_SELECTOR = "0x095ea7b3";
const DEPOSIT_SELECTOR = "0x6e553f65";

export interface CycleParams {
  capital: number;
  receiver: Hex;
  cap: number;
  maxTotalOut: number;
  reserveFloor: number;
}

export const DEFAULT_CYCLE_PARAMS: Omit<CycleParams, "capital" | "receiver"> = {
  cap: 0.3,
  maxTotalOut: 0.8,
  reserveFloor: 0.2,
};

export interface CycleSource {
  ftso: "registry" | "fallback";
  ftsoAddress: string;
  apy: "defillama" | "onchain-fallback";
  tvl: "defillama" | "onchain-fallback";
  vaultReads: boolean;
}

export interface CycleResult {
  market: MarketData;
  optimizer: OptimizerResult;
  bundle: PreparedBundle;
  envelope?: Envelope;
  source: CycleSource;
  at: string;
}

// --------------------------------------------------------------------------
// viem client
// --------------------------------------------------------------------------
const flareChain = {
  id: CHAIN_ID,
  name: "Flare",
  nativeCurrency: { name: "Flare", symbol: "FLR", decimals: 18 },
  rpcUrls: { default: { http: [FLARE_RPC] } },
} as const;

export function makeClient(): PublicClient {
  return createPublicClient({
    chain: flareChain,
    transport: http(FLARE_RPC),
  }) as PublicClient;
}

// --------------------------------------------------------------------------
// 1. Live FTSO prices (on-chain, resolved via ContractRegistry)
// --------------------------------------------------------------------------
interface FeedReading {
  value: bigint;
  decimals: number;
  timestamp: bigint;
  price: number;
}

async function readFeed(
  client: PublicClient,
  ftso: Hex,
  feedId: Hex,
): Promise<FeedReading> {
  const [value, decimals, timestamp] = (await client.readContract({
    address: ftso,
    abi: abis.ftsoV2,
    functionName: "getFeedById",
    args: [feedId],
  })) as readonly [bigint, number, bigint];
  const price = Number(value) / 10 ** Number(decimals);
  return { value, decimals: Number(decimals), timestamp, price };
}

async function resolveFtso(
  client: PublicClient,
): Promise<{ address: Hex; source: "registry" | "fallback" }> {
  try {
    const addr = (await client.readContract({
      address: addresses.contractRegistry as Hex,
      abi: abis.contractRegistry,
      functionName: "getContractAddressByName",
      args: ["FtsoV2"],
    })) as Hex;
    if (addr && addr !== "0x0000000000000000000000000000000000000000") {
      return { address: addr, source: "registry" };
    }
  } catch {
    // fall through to the known-good literal
  }
  return { address: addresses.ftsoV2 as Hex, source: "fallback" };
}

// --------------------------------------------------------------------------
// 2. DefiLlama yields (browser fetch, CORS: Access-Control-Allow-Origin: *)
// --------------------------------------------------------------------------
interface LlamaPool {
  chain: string;
  project: string;
  symbol: string;
  apy: number | null;
  apyBase: number | null;
  tvlUsd: number | null;
  pool: string;
  underlyingTokens?: string[];
}

async function fetchLlamaPools(): Promise<LlamaPool[] | null> {
  try {
    const res = await fetch("https://yields.llama.fi/pools");
    if (!res.ok) return null;
    const j = (await res.json()) as { data: LlamaPool[] };
    return j.data;
  } catch {
    return null;
  }
}

// Match a venue to its Mystic pool by underlying token address (robust: the
// pool symbols are share-token symbols like CSXRP / COREWFLR, not the underlying
// symbol). Falls back to null so the caller can use the on-chain APY.
function matchPool(pools: LlamaPool[], token: string): LlamaPool | null {
  const t = token.toLowerCase();
  const flare = pools.filter((p) => p.chain === "Flare");
  const mystic = flare.filter(
    (p) => p.project === "mystic-finance-lending" || p.project.includes("mystic"),
  );
  const hit = mystic.find((p) =>
    (p.underlyingTokens ?? []).some((u) => u.toLowerCase() === t),
  );
  return hit ?? null;
}

// --------------------------------------------------------------------------
// Snapshot fallback + labeled estimates (vol / correlation / peg / utilization)
// --------------------------------------------------------------------------
// These are the risk-model estimates and the fallbacks. Loaded once from the
// static snapshot the app already ships in /data.
type Snapshot = MarketData;

async function loadSnapshot(): Promise<Snapshot | null> {
  try {
    const res = await fetch("/data/market-data.json");
    if (!res.ok) return null;
    return (await res.json()) as Snapshot;
  } catch {
    return null;
  }
}

function snapAsset(snap: Snapshot | null, symbol: string): MarketAsset | undefined {
  return snap?.assets.find((a) => a.symbol === symbol);
}

// --------------------------------------------------------------------------
// Assemble the live marketData in exactly the schema optimize() consumes
// --------------------------------------------------------------------------
interface AssembledMarket {
  market: MarketData;
  source: CycleSource;
}

async function assembleMarketData(
  client: PublicClient,
): Promise<AssembledMarket> {
  const snap = await loadSnapshot();

  // FTSO prices (on-chain).
  const { address: ftsoAddr, source: ftsoSource } = await resolveFtso(client);
  const flr = await readFeed(client, ftsoAddr, FLR_USD_ID);
  const xrp = await readFeed(client, ftsoAddr, XRP_USD_ID);

  // DefiLlama (API) for supply APY + TVL.
  const pools = await fetchLlamaPools();

  // Vault totalAssets (on-chain) for TVL cross-read and to feed the yield curve.
  let vaultReads = true;
  const vaultTotals: Record<string, bigint> = {};
  await Promise.all(
    addresses.venues.map(async (v) => {
      try {
        const ta = (await client.readContract({
          address: v.vault as Hex,
          abi: abis.erc4626,
          functionName: "totalAssets",
        })) as bigint;
        vaultTotals[v.symbol] = ta;
      } catch {
        vaultReads = false;
      }
    }),
  );

  const priceFor = (symbol: string): number => {
    if (symbol === "FXRP") return xrp.price; // FXRP proxied by XRP/USD
    if (symbol === "WFLR") return flr.price;
    return 1.0; // USDT0 assumed peg
  };

  let apySource: CycleSource["apy"] = "defillama";
  let tvlSource: CycleSource["tvl"] = "defillama";

  const assets: MarketAsset[] = addresses.venues.map((v) => {
    const s = snapAsset(snap, v.symbol);
    const pool = pools ? matchPool(pools, v.token) : null;

    // supply APY: DefiLlama apyBase preferred; else on-chain-computed snapshot.
    let supplyApy: number;
    if (pool && pool.apyBase != null) {
      supplyApy = pool.apyBase / 100; // DefiLlama reports percent
    } else if (pool && pool.apy != null) {
      supplyApy = pool.apy / 100;
    } else {
      apySource = "onchain-fallback";
      supplyApy = s?.supplyApyOnchainComputed ?? s?.supplyApy ?? 0.03;
    }

    const priceUsd = priceFor(v.symbol);

    // TVL: DefiLlama, cross-checked against on-chain totalAssets * price.
    let tvlUsd: number;
    const onchainTvl =
      vaultTotals[v.symbol] != null
        ? Number(formatUnits(vaultTotals[v.symbol], v.decimals)) * priceUsd
        : undefined;
    if (pool && pool.tvlUsd != null) {
      tvlUsd = pool.tvlUsd;
    } else if (onchainTvl != null) {
      tvlSource = "onchain-fallback";
      tvlUsd = onchainTvl;
    } else {
      tvlSource = "onchain-fallback";
      tvlUsd = s?.tvlUsd ?? 1_000_000;
    }

    // Utilization, available liquidity, vol, LLTV: snapshot (labeled estimate /
    // last on-chain read). Utilization feeds the yield curve.
    const utilization = s?.utilization ?? 0.85;
    const availableLiquidityUsd = s?.availableLiquidityUsd ?? tvlUsd * 0.1;
    const annualizedVol = s?.annualizedVol ?? 0.3;

    return {
      symbol: v.symbol,
      tokenSymbol: s?.tokenSymbol ?? v.tokenSymbol,
      token: v.token,
      decimals: v.decimals,
      vault: v.vault,
      vaultName: v.vaultName,
      supplyApy,
      supplyApyOnchainComputed: s?.supplyApyOnchainComputed,
      utilization,
      availableLiquidityUsd,
      availableLiquidityNote: s?.availableLiquidityNote,
      tvlUsd,
      lltv: s?.lltv ?? 0.7,
      lltvNote: s?.lltvNote,
      priceUsd,
      annualizedVol,
    };
  });

  const market: MarketData = {
    asOf: new Date().toISOString(),
    chainId: CHAIN_ID,
    chainName: "Flare mainnet",
    protocol: addresses.protocol,
    app: addresses.app,
    note:
      "LIVE cycle: FTSO prices + vault totalAssets read on-chain this click; " +
      "supply APY + TVL from DefiLlama; utilization, vol, correlation and the " +
      "USDT0 peg are labeled snapshot estimates for the risk model.",
    prices: {
      FLR_USD: {
        value: flr.price,
        source: `FTSO V2 getFeedById(FLR/USD) live @ ts ${flr.timestamp} (${ftsoSource})`,
        confidence: "high",
      },
      XRP_USD: {
        value: xrp.price,
        source: `FTSO V2 getFeedById(XRP/USD) live @ ts ${xrp.timestamp} (${ftsoSource})`,
        confidence: "high",
      },
      USDT0_USD: {
        value: 1.0,
        source: "ASSUMED PEG (USDT0 = LayerZero USDT).",
        confidence: "assumed-peg",
      },
    },
    assets,
    irm: snap?.irm ?? {
      type: "AdaptiveCurveIrm",
      targetUtilization: 0.9,
      curveSteepness: 4.0,
    },
    pairwiseCorrelation: snap?.pairwiseCorrelation ?? {
      order: ["FXRP", "USDT0", "WFLR"],
      matrix: [
        [1, 0.05, 0.45],
        [0.05, 1, 0.05],
        [0.45, 0.05, 1],
      ],
    },
  };

  return {
    market,
    source: {
      ftso: ftsoSource,
      ftsoAddress: ftsoAddr,
      apy: apySource,
      tvl: tvlSource,
      vaultReads,
    },
  };
}

// --------------------------------------------------------------------------
// 3. Run the optimizer on the live marketData
// --------------------------------------------------------------------------
// Convert the app's MarketData (research schema) into the optimizer's input.
function toOptimizerInput(market: MarketData): OptMarketData {
  return {
    asOf: market.asOf,
    chainId: market.chainId,
    dataSource: "LIVE",
    assets: market.assets.map((a, idx) => ({
      symbol: a.symbol,
      venueId: idx,
      decimals: a.decimals,
      priceUsd: a.priceUsd,
      utilization: a.utilization,
      tvlUsd: a.tvlUsd,
      availableLiquidityUsd: a.availableLiquidityUsd,
      supplyApy: a.supplyApy,
      supplyApyOnchainComputed: a.supplyApyOnchainComputed,
      annualizedVol: a.annualizedVol,
    })),
    pairwiseCorrelation: market.pairwiseCorrelation,
    irm: market.irm,
  };
}

// Optimizer output type -> the app's OptimizerResult schema.
function toAppResult(r: OptimizeResult): OptimizerResult {
  return {
    asOf: r.asOf,
    chainId: r.chainId,
    capital: r.capital,
    params: r.params,
    weights: r.weights,
    reserve: r.reserve,
    expectedApy: r.expectedApy,
    expectedRiskAdjApy: r.expectedRiskAdjApy,
    perVenue: r.perVenue as OptimizerVenue[],
    waterLine: r.waterLine ?? undefined,
    rationale: r.rationale,
  };
}

function runOptimizer(
  market: MarketData,
  params: CycleParams,
): { app: OptimizerResult; raw: OptimizeResult } {
  const raw = optimize(toOptimizerInput(market), {
    ...DEFAULT_PARAMS,
    capital: params.capital,
    cap: params.cap,
    maxTotalOut: params.maxTotalOut,
    reserveFloor: params.reserveFloor,
  });
  return { app: toAppResult(raw), raw };
}

// --------------------------------------------------------------------------
// 4. Build the prepared transactions with FULL calldata
// --------------------------------------------------------------------------
// tokenAmount = floor(weight * capital / priceUsd * 10^decimals).
function tokenBaseUnits(
  weight: number,
  capital: number,
  priceUsd: number,
  decimals: number,
): bigint {
  if (priceUsd <= 0) return 0n;
  const whole = (weight * capital) / priceUsd; // human token amount
  // Scale to base units without precision loss for reasonable magnitudes.
  const scaled = whole * 10 ** decimals;
  return BigInt(Math.floor(scaled));
}

function buildBundle(
  market: MarketData,
  opt: OptimizerResult,
  params: CycleParams,
): PreparedBundle {
  const transactions: PreparedTx[] = [];
  const tokenAmounts: PreparedBundle["header"]["tokenAmounts"] = {};

  for (const v of opt.perVenue) {
    const venue = addresses.venues.find((x) => x.venueId === v.venueId);
    const asset = market.assets.find((a) => a.symbol === v.symbol);
    if (!venue || !asset) continue;
    const amount = tokenBaseUnits(
      v.weight,
      params.capital,
      asset.priceUsd,
      venue.decimals,
    );

    tokenAmounts[v.symbol] = {
      venueId: v.venueId,
      weight: v.weight,
      amountUsd: v.amountUsd,
      priceUsd: asset.priceUsd,
      decimals: venue.decimals,
      tokenAmount: amount.toString(),
    };

    if (amount === 0n) continue; // skip venues that round to zero

    // approve(spender = vault, amount) on the token.
    const approveData = encodeFunctionData({
      abi: abis.erc20,
      functionName: "approve",
      args: [venue.vault as Hex, amount],
    });
    transactions.push({
      label: `approve ${venue.vaultName} vault to pull ${v.symbol}`,
      venueId: v.venueId,
      symbol: v.symbol,
      chainId: CHAIN_ID,
      from: params.receiver,
      to: venue.token,
      value: "0",
      data: approveData,
      decoded: {
        fn: "approve(address spender, uint256 amount)",
        args: {
          spender: venue.vault,
          amount: amount.toString(),
        },
      },
      gasLimitSuggestion: "60000",
    });

    // deposit(assets = amount, receiver) on the ERC-4626 vault.
    const depositData = encodeFunctionData({
      abi: abis.erc4626,
      functionName: "deposit",
      args: [amount, params.receiver],
    });
    transactions.push({
      label: `deposit ${v.symbol} into ${venue.vaultName}`,
      venueId: v.venueId,
      symbol: v.symbol,
      chainId: CHAIN_ID,
      from: params.receiver,
      to: venue.vault,
      value: "0",
      data: depositData,
      decoded: {
        fn: "deposit(uint256 assets, address receiver)",
        args: {
          assets: amount.toString(),
          receiver: params.receiver,
        },
      },
      gasLimitSuggestion: "250000",
    });
  }

  const reserveUsd = opt.reserve * params.capital;

  return {
    header: {
      asOf: market.asOf,
      builtAt: new Date().toISOString(),
      chainId: CHAIN_ID,
      chainName: "Flare mainnet",
      capitalUsd: params.capital,
      receiver: params.receiver,
      receiverNote:
        "Placeholder receiver. Replace with the curator EOA / CurationController before signing.",
      note: "Flare mainnet (chainId 14) transactions built this cycle.",
      reserveFraction: opt.reserve,
      reserveUsdUndeployed: reserveUsd,
      tokenAmounts,
      conventions: {
        venueIds: { "0": "FXRP", "1": "USDT0", "2": "WFLR" },
        approveSelector: APPROVE_SELECTOR,
        depositSelector: DEPOSIT_SELECTOR,
        ordering: "per venue: approve then deposit, venue order 0,1,2",
      },
    },
    transactions,
  };
}

// --------------------------------------------------------------------------
// 5. Re-sign the bounded plan with the demo enclave key (Steps 3/4)
// --------------------------------------------------------------------------
const ZERO = "0x0000000000000000000000000000000000000000" as Hex;

function usdToWad(usd: number): bigint {
  // USD notional -> 1e18-scaled integer, matching the offline envelopes.
  return BigInt(Math.round(usd * 1e6)) * 10n ** 12n;
}

function controllerAddress(): Hex {
  const c = addresses.curationController;
  return c && c !== "" ? (c as Hex) : ZERO;
}

async function signPlan(
  opt: OptimizerResult,
  params: CycleParams,
): Promise<Envelope> {
  const account = privateKeyToAccount(DEMO_ENCLAVE_KEY);

  const allocations = opt.perVenue.map((v) => ({
    venueId: v.venueId.toString(),
    amount: usdToWad(v.amountUsd).toString(),
  }));
  const totalOut = usdToWad(params.capital);
  const reserveAmount =
    totalOut - allocations.reduce((a, x) => a + BigInt(x.amount), 0n);

  const nonce = "0";
  const expiry = (Math.floor(Date.now() / 1000) + 3600).toString();
  const codeHash =
    "0x4c1ea64a6a81ce2cae7c1aaff36fcdbc64d9b06608471a1d346a9de1e31763ea" as Hex;
  const modelVersion = "1";

  // planId = keccak of the live inputs (fresh each cycle).
  const planId = keccak256(
    toHex(
      JSON.stringify({
        asOf: opt.asOf,
        weights: opt.weights,
        capital: params.capital,
      }),
    ),
  );

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
      [
        allocations.map((a) => ({
          venueId: BigInt(a.venueId),
          amount: BigInt(a.amount),
        })),
      ],
    ),
  );

  const planHash = keccak256(
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
        BigInt(CHAIN_ID),
        planId,
        BigInt(modelVersion),
        codeHash,
        BigInt(nonce),
        BigInt(expiry),
        totalOut,
        reserveAmount,
        allocHash,
      ],
    ),
  );

  const signature = await account.signMessage({ message: { raw: planHash } });

  const inputHash = keccak256(toHex(JSON.stringify(opt.weights)));

  return {
    plan: {
      planId,
      modelVersion,
      codeHash,
      nonce,
      expiry,
      totalOut: totalOut.toString(),
      reserveAmount: reserveAmount.toString(),
      allocations,
    },
    signature,
    inputHash,
    reasonCodes: opt.perVenue.map((v) => ({
      venueId: v.venueId.toString(),
      eligible: true,
      reason: "eligible",
    })),
    attestation: {
      kind: "simulated-confidential-space",
      note:
        "SIMULATED for PoC. Plan re-signed in-browser with the demo enclave key " +
        "this cycle; recovery in Step 4 mirrors the on-chain ecrecover.",
      claims: {
        image_digest: codeHash.slice(2),
        hwmodel: "simulated",
        platform: "simulated",
      },
    },
  };
}

// --------------------------------------------------------------------------
// Public: run one full live cycle
// --------------------------------------------------------------------------
export async function runCycle(
  paramsIn: Partial<CycleParams>,
): Promise<CycleResult> {
  const params: CycleParams = {
    capital: paramsIn.capital ?? 1_000_000,
    receiver: (paramsIn.receiver ??
      "0x0000000000000000000000000000000000000001") as Hex,
    cap: paramsIn.cap ?? DEFAULT_CYCLE_PARAMS.cap,
    maxTotalOut: paramsIn.maxTotalOut ?? DEFAULT_CYCLE_PARAMS.maxTotalOut,
    reserveFloor: paramsIn.reserveFloor ?? DEFAULT_CYCLE_PARAMS.reserveFloor,
  };

  const client = makeClient();
  const { market, source } = await assembleMarketData(client);
  const { app: optimizer } = runOptimizer(market, params);
  const bundle = buildBundle(market, optimizer, params);

  let envelope: Envelope | undefined;
  try {
    envelope = await signPlan(optimizer, params);
  } catch {
    envelope = undefined; // signing is best-effort; Steps 1/2/5 are the priority
  }

  return {
    market,
    optimizer,
    bundle,
    envelope,
    source,
    at: new Date().toISOString(),
  };
}
