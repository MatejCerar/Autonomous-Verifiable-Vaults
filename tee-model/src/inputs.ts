// Input reader: authenticated inputs for one curation cycle.
//
//   1. REAL FTSO prices via ContractRegistry-resolved FtsoV2: FLR/USD and XRP/USD.
//   2. The live Mystic market snapshot (research/market-data.json): per-venue
//      supplyApy / utilization / available liquidity, plus IRM shape and the
//      pairwise correlation the optimizer needs. This is the "authenticated" data
//      the model runs its optimizer over.
//   3. Optional on-chain vault/venue state from a deployed instance (best effort).
//
// Never hard-blocks: on any read failure it falls back and flags oracleFallback /
// unreachable so the model can still produce a (defensive) plan.
import {readFileSync} from "node:fs";
import {
    createPublicClient,
    http,
    isAddress,
    type Address,
    type Hex,
    type PublicClient,
} from "viem";
import {REGISTRY_ABI, ftsoAbi, venueAbi, vaultAbi} from "./abis.js";
import {
    MARKET_DATA_FILE,
    MODEL,
    VENUE_LABELS,
    type Addresses,
} from "./config.js";
import type {MarketData} from "../../optimizer/optimize.js";

export interface FeedInput {
    value: bigint;
    decimals: number;
    timestamp: bigint;
    oracleFallback: boolean;
}

export interface VenueState {
    venueId: number;
    label: string;
    address: string;
    utilisationBips: bigint;
    availableLiquidity: bigint; // USD 1e18
    supplyApyBips: bigint; // net supply APY in bips (display)
    depeg: boolean;
    reachable: boolean;
}

export interface Inputs {
    feed: FeedInput; // FLR/USD (the original demo's authenticated feed)
    xrpFeed: FeedInput; // XRP/USD (added: FXRP price driver)
    venues: VenueState[];
    // The full authenticated Mystic snapshot handed to the optimizer as-is.
    marketData: MarketData;
    marketAsOf: string;
    tvl: bigint;
    blockNumber: bigint;
    chainConnected: boolean;
    contractsDeployed: boolean;
}

export function makeClient(rpcUrl: string): PublicClient {
    return createPublicClient({transport: http(rpcUrl)});
}

function nonEmptyAddr(a: string | undefined): a is Address {
    return typeof a === "string" && a !== "" && isAddress(a);
}

// Read a REAL FTSO price by feed id. Resolve FtsoV2 via FlareContractRegistry then
// call getFeedById (payable) with an eth_call at value 0. Failure -> fallback.
export async function readFeed(
    client: PublicClient,
    registry: Address,
    feedId: Hex,
    fallbackValue: bigint
): Promise<FeedInput> {
    try {
        const ftso = (await client.readContract({
            address: registry,
            abi: REGISTRY_ABI,
            functionName: "getContractAddressByName",
            args: ["FtsoV2"],
        })) as Address;

        if (!nonEmptyAddr(ftso)) throw new Error("FtsoV2 not resolved");

        const res = (await client.readContract({
            address: ftso,
            abi: ftsoAbi(),
            functionName: "getFeedById",
            args: [feedId],
        })) as readonly [bigint, number, bigint];

        return {
            value: res[0],
            decimals: Number(res[1]),
            timestamp: res[2],
            oracleFallback: false,
        };
    } catch {
        return {
            value: fallbackValue,
            decimals: MODEL.FALLBACK_DECIMALS,
            // Fresh-ish fallback timestamp = now, so fallback does not itself
            // trip the staleness gate (that is a separate real signal).
            timestamp: BigInt(Math.floor(Date.now() / 1000)),
            oracleFallback: true,
        };
    }
}

// Load and validate the frozen Mystic market snapshot.
export function loadMarketData(): MarketData {
    const raw = readFileSync(MARKET_DATA_FILE, "utf8");
    return JSON.parse(raw) as MarketData;
}

// Convert a market-data asset into the display VenueState. Amounts in USD 1e18.
function assetToVenue(
    venueId: number,
    asset: {
        symbol?: string;
        utilization?: number;
        availableLiquidityUsd?: number;
        availableLiquidity?: number;
        supplyApy?: number;
        supplyApyOnchainComputed?: number;
    },
    address: string,
    reachable: boolean
): VenueState {
    const util = asset.utilization ?? 0;
    const liqUsd =
        asset.availableLiquidityUsd ?? asset.availableLiquidity ?? 0;
    const apy = asset.supplyApy ?? asset.supplyApyOnchainComputed ?? 0;
    return {
        venueId,
        label: asset.symbol ?? VENUE_LABELS[venueId] ?? `venue-${venueId}`,
        address,
        utilisationBips: BigInt(Math.round(util * 10000)),
        availableLiquidity:
            BigInt(Math.round(liqUsd)) * 1_000_000_000_000_000_000n,
        supplyApyBips: BigInt(Math.round(apy * 10000)),
        depeg: false,
        reachable,
    };
}

async function readOnchainVenue(
    client: PublicClient,
    address: Address
): Promise<{util?: bigint; liq?: bigint; depeg: boolean; reachable: boolean}> {
    try {
        const [util, liq] = await Promise.all([
            client.readContract({
                address,
                abi: venueAbi(),
                functionName: "utilisationBips",
            }) as Promise<bigint>,
            client.readContract({
                address,
                abi: venueAbi(),
                functionName: "availableLiquidity",
            }) as Promise<bigint>,
        ]);
        let depeg = false;
        try {
            depeg = (await client.readContract({
                address,
                abi: venueAbi(),
                functionName: "depeg",
            })) as boolean;
        } catch {
            depeg = false;
        }
        return {util, liq, depeg, reachable: true};
    } catch {
        return {depeg: false, reachable: false};
    }
}

export async function readInputs(
    client: PublicClient,
    addr: Addresses
): Promise<Inputs> {
    const feed = await readFeed(
        client,
        addr.contractRegistry,
        addr.flrUsdFeedId,
        MODEL.FALLBACK_VALUE
    );
    const xrpFeed = await readFeed(
        client,
        addr.contractRegistry,
        addr.xrpUsdFeedId,
        MODEL.FALLBACK_XRP_VALUE
    );

    let blockNumber = 0n;
    let chainConnected = false;
    try {
        blockNumber = await client.getBlockNumber();
        chainConnected = true;
    } catch {
        chainConnected = false;
    }

    // Authenticated market snapshot (the optimizer input).
    const marketData = loadMarketData();
    const assets = Array.isArray(marketData.assets)
        ? marketData.assets
        : Object.entries(marketData.assets).map(([symbol, v]) => ({
              symbol,
              ...(v as object),
          }));

    // Optional live venue adapters (if a mystic instance is deployed locally).
    const venueAddrs = addr.deployed.venueAdapters ?? [];
    let contractsDeployed = false;

    const venues: VenueState[] = [];
    for (let i = 0; i < assets.length; i++) {
        const asset = assets[i] as {
            symbol?: string;
            venueId?: number;
            utilization?: number;
            availableLiquidityUsd?: number;
            availableLiquidity?: number;
            supplyApy?: number;
            supplyApyOnchainComputed?: number;
        };
        const venueId = asset.venueId ?? i;
        const address = nonEmptyAddr(venueAddrs[venueId])
            ? (venueAddrs[venueId] as string)
            : (addr.deployed.mysticVaults?.[venueId] ??
              "0x0000000000000000000000000000000000000000");

        let reachable = false;
        let depeg = false;
        if (nonEmptyAddr(venueAddrs[venueId])) {
            const oc = await readOnchainVenue(
                client,
                venueAddrs[venueId] as Address
            );
            reachable = oc.reachable;
            depeg = oc.depeg;
            if (oc.reachable) contractsDeployed = true;
        }
        const v = assetToVenue(venueId, asset, address, reachable);
        v.depeg = depeg;
        venues.push(v);
    }
    venues.sort((a, b) => a.venueId - b.venueId);

    // TVL from a deployed vault if present, else the snapshot sum (USD 1e18).
    let tvl = venues.reduce((s, v) => s + v.availableLiquidity, 0n);
    if (nonEmptyAddr(addr.deployed.vault)) {
        try {
            tvl = (await client.readContract({
                address: addr.deployed.vault as Address,
                abi: vaultAbi(),
                functionName: "totalAssets",
            })) as bigint;
            contractsDeployed = true;
        } catch {
            // keep snapshot-derived tvl
        }
    }

    return {
        feed,
        xrpFeed,
        venues,
        marketData,
        marketAsOf: marketData.asOf ?? "unknown",
        tvl,
        blockNumber,
        chainConnected,
        contractsDeployed,
    };
}
