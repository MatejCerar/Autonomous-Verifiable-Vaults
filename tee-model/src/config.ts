// Central configuration + addresses.json loader. No randomness anywhere.
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import type {Hex} from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));

// demo/tee-model/src -> demo/
export const DEMO_ROOT = join(__dirname, "..", "..");
export const ADDRESSES_FILE = join(DEMO_ROOT, "addresses.json");
export const ABI_DIR = join(DEMO_ROOT, "abi");

export interface Addresses {
    chainId: number;
    network: string;
    rpcUrl: string;
    contractRegistry: Hex;
    flrUsdFeedId: Hex;
    teeSignerAddress: string;
    modelVersion: string;
    codeHash: string;
    deployed: {
        mockStable: string;
        vault: string;
        mandateRegistry: string;
        curationController: string;
        reserveAdapter: string;
        venueAdapters: string[];
        mockVenues: string[];
    };
}

export function loadAddresses(): Addresses {
    const raw = readFileSync(ADDRESSES_FILE, "utf8");
    return JSON.parse(raw) as Addresses;
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
    // hard limit, clamped separately).
    MAX_UTIL_BIPS: 9000n, // 90%
    MIN_LIQUIDITY: 1n, // must have some liquidity
    // Fraction of TVL the model tries to deploy per cycle. Kept under
    // (maxTotalOut - reserveFloor) so the plan sits comfortably inside caps.
    TARGET_DEPLOY_BIPS: 5000n, // 50% (25% per venue across two)
    // Mandatory reserve floor as fraction of TVL. Matches on-chain minReserveBips.
    MIN_RESERVE_BIPS: 2000n, // 20%
    // Per-venue clamp as fraction of TVL. Matches on-chain venueCapBips so a
    // good plan always passes the on-chain venue-cap check.
    VENUE_CAP_BIPS: 3000n, // 30%
    // Depeg band: |value/par - 1| <= band. Par is 1.0 in feed units.
    DEPEG_BAND_BIPS: 200n, // 2%
    // Fallback FLR/USD value if the on-chain read fails (never hard-block demo).
    FALLBACK_VALUE: 2000000n, // 0.0200000 at 7 decimals (arbitrary safe value)
    FALLBACK_DECIMALS: 7,
    // Fallback TVL when contracts are not deployed (self-test / disconnected).
    FALLBACK_TVL: 1000000000000000000000n, // 1000e18
} as const;

export const BIPS_DENOM = 10000n;
