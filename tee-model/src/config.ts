// Central configuration + addresses.json loader. No randomness anywhere.
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import type {Hex} from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));

// tee-model/src -> repo root
export const DEMO_ROOT = join(__dirname, "..", "..");
// Single source of truth for the active deployment. Ships as the mainnet-prepare
// default (no controller deployed); a deploy script (DeployTestnet on Coston2 or
// DeployMystic on Flare mainnet) overwrites addresses.json with the live stack.
export const ADDRESSES_FILE = join(DEMO_ROOT, "addresses.json");
export const ABI_DIR = join(DEMO_ROOT, "abi");
// Live Flare-mainnet Mystic market snapshot the model runs its optimizer over.
export const MARKET_DATA_FILE = join(DEMO_ROOT, "research", "market-data.json");

export interface Addresses {
    chainId: number;
    network: string;
    rpcUrl: string;
    contractRegistry: Hex;
    flrUsdFeedId: Hex;
    xrpUsdFeedId: Hex;
    teeSignerAddress: string;
    modelVersion: string;
    codeHash: string;
    deployed: {
        vault: string;
        mandateRegistry: string;
        curationController: string;
        reserveAdapter: string;
        // Live Mystic venue adapters, index-aligned to venue ids 0,1,2.
        venueAdapters: string[];
        // Live Mystic Core ERC-4626 vaults (asset-state read for eligibility).
        mysticVaults: string[];
    };
}

// Canonical venue ordering. MUST match contracts/src/MysticAddresses.sol and
// contracts/script/DeployMystic.s.sol adapters[] order: 0=FXRP, 1=USDT0, 2=WFLR.
export const VENUE_COUNT = 3;
export const VENUE_LABELS = ["FXRP", "USDT0", "WFLR"] as const;

// Flare mainnet (chainId 14) Mystic Core vaults + tokens, from MysticAddresses.sol.
// Index-aligned to venue ids above. Used as the offline default when no
// addresses.json is present (mystic contracts not deployed to a local chain).
export const MYSTIC_VAULTS = [
    "0x53184aDaBF312b490BF1EbcFdC896FEfF6019a14", // FXRP  Core FXRP
    "0xE8dd6A1e13244A27bDaa19CcBf33013647C675d1", // USDT0 Core USDT0
    "0x1aEadA3C251215f1294720B80FcB3D1D005F3585", // WFLR  Core wFLR
] as const;

// FTSO V2 21-byte feed ids (0x01 category + UTF-8 hex, right zero-padded).
export const FLR_USD_FEED_ID =
    "0x01464c522f55534400000000000000000000000000" as Hex; // "FLR/USD"
export const XRP_USD_FEED_ID =
    "0x015852502f55534400000000000000000000000000" as Hex; // "XRP/USD"

// Offline default addresses when demo-mystic/addresses.json is absent. The
// optimizer reads the frozen market snapshot regardless; on-chain reads simply
// fall back. chainId 14 = Flare mainnet (where Mystic lives).
export const DEFAULT_ADDRESSES: Addresses = {
    chainId: 14,
    network: "flare",
    rpcUrl: "https://flare-api.flare.network/ext/C/rpc",
    contractRegistry: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
    flrUsdFeedId: FLR_USD_FEED_ID,
    xrpUsdFeedId: XRP_USD_FEED_ID,
    teeSignerAddress: "",
    modelVersion: "1",
    codeHash: "",
    deployed: {
        vault: "",
        mandateRegistry: "",
        curationController: "",
        reserveAdapter: "",
        venueAdapters: [],
        mysticVaults: [...MYSTIC_VAULTS],
    },
};

export function loadAddresses(): Addresses {
    let parsed: Partial<Addresses> = {};
    try {
        parsed = JSON.parse(readFileSync(ADDRESSES_FILE, "utf8")) as Partial<Addresses>;
    } catch {
        // No addresses.json (mystic contracts not deployed) -> defaults only.
        return {...DEFAULT_ADDRESSES};
    }
    // Merge over the defaults so feed ids / mystic vaults are always present.
    const deployed = {
        ...DEFAULT_ADDRESSES.deployed,
        ...(parsed.deployed ?? {}),
    };
    if (!deployed.mysticVaults || deployed.mysticVaults.length === 0) {
        deployed.mysticVaults = [...MYSTIC_VAULTS];
    }
    return {
        ...DEFAULT_ADDRESSES,
        ...parsed,
        flrUsdFeedId: (parsed.flrUsdFeedId as Hex) ?? FLR_USD_FEED_ID,
        xrpUsdFeedId: (parsed.xrpUsdFeedId as Hex) ?? XRP_USD_FEED_ID,
        deployed,
    };
}

// Environment. .env is loaded by loadEnv() (no dotenv dependency).
export function loadEnv(): void {
    // Minimal .env loader (no external dep). Existing process.env wins.
    try {
        const envPath = join(__dirname, "..", ".env");
        const raw = readFileSync(envPath, "utf8");
        for (const line of raw.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eq = trimmed.indexOf("=");
            if (eq === -1) continue;
            const key = trimmed.slice(0, eq).trim();
            let val = trimmed.slice(eq + 1).trim();
            if (
                (val.startsWith('"') && val.endsWith('"')) ||
                (val.startsWith("'") && val.endsWith("'"))
            ) {
                val = val.slice(1, -1);
            }
            if (process.env[key] === undefined) process.env[key] = val;
        }
    } catch {
        // no .env file; rely on process env + defaults
    }
}

// Anvil default account #0. Deterministic simulated TEE key.
export const DEFAULT_TEE_PRIVATE_KEY =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

export function getTeePrivateKey(): Hex {
    return (process.env.TEE_PRIVATE_KEY ?? DEFAULT_TEE_PRIVATE_KEY) as Hex;
}

export function getRpcUrl(addr: Addresses): string {
    return process.env.RPC_URL ?? addr.rpcUrl;
}

// If set, the model signs plans via the REAL TEE node /sign endpoint instead of
// the local key. e.g. http://127.0.0.1:7701/sign
export function getTeeSignUrl(): string | undefined {
    return process.env.TEE_SIGN_URL || undefined;
}

// Deterministic model tuning constants (no randomness).
export const MODEL = {
    // FTSO input older than this (seconds) is treated as stale.
    MAX_STALENESS_SECONDS: 600n,
    // Per-venue eligibility caps (model-side; the on-chain venueCapBips is the
    // hard limit, enforced by the optimizer's own per-venue cap too).
    MAX_UTIL_BIPS: 9900n, // 99% (Mystic markets run hot; do not gate them out)
    MIN_LIQUIDITY: 1n, // must have some liquidity
    // Mandatory reserve floor as fraction of capital. Matches on-chain
    // minReserveBips AND the optimizer reserveFloor (0.2).
    MIN_RESERVE_BIPS: 2000n, // 20%
    // Per-venue clamp as fraction of capital. Matches on-chain venueCapBips AND
    // the optimizer per-venue cap (0.3) so a good plan always passes on-chain.
    VENUE_CAP_BIPS: 3000n, // 30%
    // Cap on total deployed (sum of venue weights). Matches optimizer maxTotalOut.
    MAX_TOTAL_OUT_BIPS: 8000n, // 80%
    // Depeg band: |value/par - 1| <= band. Par is 1.0 in feed units.
    DEPEG_BAND_BIPS: 200n, // 2%
    // Fallback FLR/USD value if the on-chain read fails (never hard-block demo).
    // 0.0059951 at 7 decimals, matching the live snapshot in market-data.json.
    FALLBACK_VALUE: 59951n,
    FALLBACK_DECIMALS: 7,
    // Fallback XRP/USD value (1.013054 at 7 decimals) matching the snapshot.
    FALLBACK_XRP_VALUE: 10130540n,
} as const;

// Plan accounting unit: USD in 1e18 fixed point (like the demo's 18-dec mock
// stable). Capital C default = 1,000,000 USD.
export const CAPITAL_USD = 1_000_000n;
export const USD_1E18 = 1_000_000_000_000_000_000n;
export const CAPITAL_WEI = CAPITAL_USD * USD_1E18; // 1000000e18

export const BIPS_DENOM = 10000n;
