// Input reader: REAL FTSO price via ContractRegistry-resolved FtsoV2, plus
// venue/vault state from the deployed mock contracts. Never hard-blocks: on any
// read failure it falls back and sets oracleFallback / a disconnected flag.
import {
    createPublicClient,
    http,
    isAddress,
    type Address,
    type Hex,
    type PublicClient,
} from "viem";
import {
    REGISTRY_ABI,
    ftsoAbi,
    venueAbi,
    vaultAbi,
} from "./abis.js";
import {MODEL, type Addresses} from "./config.js";

export interface FeedInput {
    value: bigint;
    decimals: number;
    timestamp: bigint;
    oracleFallback: boolean;
}

export interface VenueState {
    venueId: number;
    address: string;
    utilisationBips: bigint;
    availableLiquidity: bigint;
    depeg: boolean;
    reachable: boolean;
}

export interface Inputs {
    feed: FeedInput;
    venues: VenueState[];
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

// Read a REAL FTSO price. Resolve FtsoV2 via FlareContractRegistry then call
// getFeedById (payable) with an eth_call at value 0 (fee is 0 for FLR/USD on
// Coston2). Any failure -> fallback value + oracleFallback=true.
export async function readFeed(
    client: PublicClient,
    registry: Address,
    feedId: Hex
): Promise<FeedInput> {
    try {
        const ftso = (await client.readContract({
            address: registry,
            abi: REGISTRY_ABI,
            functionName: "getContractAddressByName",
            args: ["FtsoV2"],
        })) as Address;

        if (!nonEmptyAddr(ftso)) throw new Error("FtsoV2 not resolved");

        // getFeedById is payable; simulate/eth_call at value 0.
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
            value: MODEL.FALLBACK_VALUE,
            decimals: MODEL.FALLBACK_DECIMALS,
            // Fresh-ish fallback timestamp = now, so fallback does not itself
            // trigger the staleness gate (that is a separate real signal).
            timestamp: BigInt(Math.floor(Date.now() / 1000)),
            oracleFallback: true,
        };
    }
}

async function readVenue(
    client: PublicClient,
    venueId: number,
    address: Address
): Promise<VenueState> {
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
        // depeg is a demo knob; not every venue exposes it -> default false.
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
        return {
            venueId,
            address,
            utilisationBips: util,
            availableLiquidity: liq,
            depeg,
            reachable: true,
        };
    } catch {
        return {
            venueId,
            address,
            utilisationBips: 0n,
            availableLiquidity: 0n,
            depeg: false,
            reachable: false,
        };
    }
}

export async function readInputs(
    client: PublicClient,
    addr: Addresses
): Promise<Inputs> {
    const feed = await readFeed(
        client,
        addr.contractRegistry,
        addr.flrUsdFeedId
    );

    let blockNumber = 0n;
    let chainConnected = false;
    try {
        blockNumber = await client.getBlockNumber();
        chainConnected = true;
    } catch {
        chainConnected = false;
    }

    const venueAddrs = addr.deployed.mockVenues ?? [];
    const venues: VenueState[] = [];
    let contractsDeployed = false;

    if (venueAddrs.length > 0 && venueAddrs.every(nonEmptyAddr)) {
        for (let i = 0; i < venueAddrs.length; i++) {
            venues.push(await readVenue(client, i, venueAddrs[i] as Address));
        }
        contractsDeployed = venues.some((v) => v.reachable);
    }

    // TVL from vault, else fallback.
    let tvl: bigint = MODEL.FALLBACK_TVL;
    if (nonEmptyAddr(addr.deployed.vault)) {
        try {
            tvl = (await client.readContract({
                address: addr.deployed.vault as Address,
                abi: vaultAbi(),
                functionName: "totalAssets",
            })) as bigint;
            contractsDeployed = true;
        } catch {
            tvl = MODEL.FALLBACK_TVL;
        }
    }

    // If no venues could be read from chain, synthesise a deterministic 2-venue
    // healthy baseline so the model + sign path can be exercised offline.
    if (venues.length === 0) {
        venues.push(
            {
                venueId: 0,
                address: "0x0000000000000000000000000000000000000000",
                utilisationBips: 4000n,
                availableLiquidity: 500000000000000000000n,
                depeg: false,
                reachable: false,
            },
            {
                venueId: 1,
                address: "0x0000000000000000000000000000000000000000",
                utilisationBips: 6000n,
                availableLiquidity: 300000000000000000000n,
                depeg: false,
                reachable: false,
            }
        );
    }

    return {feed, venues, tvl, blockNumber, chainConnected, contractsDeployed};
}
