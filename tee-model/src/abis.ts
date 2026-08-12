// Minimal inline ABIs for the getters this service needs. If demo/abi/*.json
// exist (forge-exported after the contracts are built) we prefer those, else we
// fall back to these hand-written fragments. Only read-only getters are needed.
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import type {Abi} from "viem";
import {ABI_DIR} from "./config.js";

// FlareContractRegistry: name -> address resolver.
export const REGISTRY_ABI = [
    {
        type: "function",
        name: "getContractAddressByName",
        stateMutability: "view",
        inputs: [{name: "_name", type: "string"}],
        outputs: [{name: "", type: "address"}],
    },
] as const satisfies Abi;

// FtsoV2Interface: getFeedById is payable.
export const FTSOV2_ABI = [
    {
        type: "function",
        name: "getFeedById",
        stateMutability: "payable",
        inputs: [{name: "_feedId", type: "bytes21"}],
        outputs: [
            {name: "_value", type: "uint256"},
            {name: "_decimals", type: "int8"},
            {name: "_timestamp", type: "uint64"},
        ],
    },
] as const satisfies Abi;

// MockLendingVenue getters + demo depeg knob.
export const VENUE_ABI = [
    {
        type: "function",
        name: "utilisationBips",
        stateMutability: "view",
        inputs: [],
        outputs: [{name: "", type: "uint256"}],
    },
    {
        type: "function",
        name: "availableLiquidity",
        stateMutability: "view",
        inputs: [],
        outputs: [{name: "", type: "uint256"}],
    },
    {
        type: "function",
        name: "depeg",
        stateMutability: "view",
        inputs: [],
        outputs: [{name: "", type: "bool"}],
    },
] as const satisfies Abi;

// AutomatedCurationVault TVL getter.
export const VAULT_ABI = [
    {
        type: "function",
        name: "totalAssets",
        stateMutability: "view",
        inputs: [],
        outputs: [{name: "", type: "uint256"}],
    },
] as const satisfies Abi;

// CurationController nonce (read for the plan).
export const CONTROLLER_ABI = [
    {
        type: "function",
        name: "nonce",
        stateMutability: "view",
        inputs: [],
        outputs: [{name: "", type: "uint256"}],
    },
    {
        type: "function",
        name: "usedPlanIds",
        stateMutability: "view",
        inputs: [{name: "", type: "bytes32"}],
        outputs: [{name: "", type: "bool"}],
    },
] as const satisfies Abi;

// Prefer a forge-exported ABI if present, else the inline fragment.
function loadAbi(fileName: string, fallback: Abi): Abi {
    try {
        const p = join(ABI_DIR, fileName);
        if (existsSync(p)) {
            const parsed = JSON.parse(readFileSync(p, "utf8"));
            // forge export shape: { abi: [...] } or a bare array.
            const abi = Array.isArray(parsed) ? parsed : parsed.abi;
            if (Array.isArray(abi) && abi.length > 0) return abi as Abi;
        }
    } catch {
        // ignore, use fallback
    }
    return fallback;
}

export function ftsoAbi(): Abi {
    return loadAbi("FtsoV2Interface.json", FTSOV2_ABI as unknown as Abi);
}
export function venueAbi(): Abi {
    return loadAbi("MockLendingVenue.json", VENUE_ABI as unknown as Abi);
}
export function vaultAbi(): Abi {
    return loadAbi(
        "AutomatedCurationVault.json",
        VAULT_ABI as unknown as Abi
    );
}
export function controllerAbi(): Abi {
    return loadAbi(
        "CurationController.json",
        CONTROLLER_ABI as unknown as Abi
    );
}
