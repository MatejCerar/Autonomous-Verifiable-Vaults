// build.mjs
// Reproducible builder for the demo-mystic prepared (UNSIGNED) transactions.
//
// Reads:
//   ../optimizer/result.json      -> weights + reserve + capital (optimizer output over live data)
//   ../research/market-data.json  -> token/vault addresses, decimals, live USD prices
//   ../contracts/src/MysticAddresses.sol (informational; addresses cross-checked below)
//
// Writes:
//   ./bundle.json  -> ordered array of unsigned txs (approve + ERC-4626 deposit per venue)
//
// NOTHING here is signed or broadcast. Every number is derived from the two input
// JSONs so the bundle is fully reproducible and deterministic.
//
// Run:  node build.mjs

import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {
    encodeFunctionData,
    decodeFunctionData,
    getAddress,
    parseAbi,
} from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HERE = __dirname;
const ROOT = join(HERE, "..");

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
const result = JSON.parse(
    readFileSync(join(ROOT, "optimizer", "result.json"), "utf8")
);
const market = JSON.parse(
    readFileSync(join(ROOT, "research", "market-data.json"), "utf8")
);

const CHAIN_ID = 14; // Flare mainnet
if (result.chainId !== CHAIN_ID) {
    throw new Error(`optimizer chainId ${result.chainId} != ${CHAIN_ID}`);
}
if (market.chainId !== CHAIN_ID) {
    throw new Error(`market chainId ${market.chainId} != ${CHAIN_ID}`);
}

const CAPITAL_USD = result.capital; // default 1,000,000 USD notional
if (typeof CAPITAL_USD !== "number" || CAPITAL_USD <= 0) {
    throw new Error(`bad capital in result.json: ${CAPITAL_USD}`);
}

// Receiver of the ERC-4626 vault shares. Placeholder curator address; the real
// broadcaster substitutes the deployed CurationController / curator EOA. Kept as
// a clearly-labeled non-zero placeholder so calldata is well-formed and decodable.
const RECEIVER = "0x0000000000000000000000000000000000000001";
const SENDER = "{{SENDER}}"; // filled in by the wallet/relayer at broadcast time

// ---------------------------------------------------------------------------
// Canonical addresses cross-check (MysticAddresses.sol / DeployMystic.s.sol).
// Venue ids: 0 = FXRP, 1 = USDT0, 2 = WFLR.
// ---------------------------------------------------------------------------
const CANON = {
    FXRP: {
        venueId: 0,
        token: "0xAd552A648C74D49E10027AB8a618A3ad4901c5bE",
        vault: "0x53184aDaBF312b490BF1EbcFdC896FEfF6019a14",
    },
    USDT0: {
        venueId: 1,
        token: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D",
        vault: "0xE8dd6A1e13244A27bDaa19CcBf33013647C675d1",
    },
    WFLR: {
        venueId: 2,
        token: "0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d",
        vault: "0x1aEadA3C251215f1294720B80FcB3D1D005F3585",
    },
};

// ---------------------------------------------------------------------------
// Price lookup (USD per whole token) from market-data.json.
// ---------------------------------------------------------------------------
function priceUsdFor(symbol) {
    const asset = market.assets.find((a) => a.symbol === symbol);
    if (!asset) throw new Error(`no market asset for ${symbol}`);
    if (typeof asset.priceUsd !== "number" || asset.priceUsd <= 0) {
        throw new Error(`bad priceUsd for ${symbol}: ${asset.priceUsd}`);
    }
    return asset;
}

// ---------------------------------------------------------------------------
// Native token amount (integer, floor) from a USD amount.
//   tokenAmount = floor( usd / priceUsd * 10^decimals )
// Done with BigInt-safe scaling to avoid float drift on the integer result.
// We scale the USD/price ratio through a large fixed-point base then floor.
// ---------------------------------------------------------------------------
function tokenAmountFromUsd(usd, priceUsd, decimals) {
    // Use a high-precision intermediate in floating point for the ratio, then
    // realise the integer with BigInt. usd and priceUsd are plain USD magnitudes
    // (<= ~1e6 and ~1 respectively) so double precision is ample for the ratio;
    // the final floor to base-units is exact because we compute the scaled
    // integer via string of a fixed-decimals fixed-point.
    const ratio = usd / priceUsd; // whole tokens (fractional)
    // Convert `ratio` whole-tokens to base units with `decimals`, flooring.
    // Represent ratio with enough decimal places, then shift.
    const PREC = 30; // guard digits
    const scaled = ratio * Math.pow(10, 0); // whole tokens
    // Build a fixed-point decimal string of `ratio` with PREC fractional digits.
    const fixedStr = scaled.toFixed(PREC); // e.g. "83657.929...."
    const [intPart, fracPart = ""] = fixedStr.split(".");
    const fracPadded = (fracPart + "0".repeat(decimals)).slice(0, decimals);
    const baseUnitsStr = intPart + fracPadded; // floor by truncation
    // Strip leading zeros safely.
    const cleaned = baseUnitsStr.replace(/^0+(?=\d)/, "");
    return BigInt(cleaned);
}

// ERC20.approve(address,uint256) and ERC-4626.deposit(uint256,address)
const erc20Abi = parseAbi([
    "function approve(address spender, uint256 amount) returns (bool)",
]);
const erc4626Abi = parseAbi([
    "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
]);

const APPROVE_SELECTOR = "0x095ea7b3";
const DEPOSIT_SELECTOR = "0x6e553f65";

// ---------------------------------------------------------------------------
// Build per-venue in canonical venue order (0,1,2).
// ---------------------------------------------------------------------------
const order = ["FXRP", "USDT0", "WFLR"];
const txs = [];
const tokenAmountsOut = {};
const pricesOut = {};
let deployedUsdSum = 0;

for (const symbol of order) {
    const canon = CANON[symbol];
    const asset = priceUsdFor(symbol);

    // cross-check canonical vs market-data addresses
    if (getAddress(asset.token) !== getAddress(canon.token)) {
        throw new Error(
            `${symbol} token mismatch market ${asset.token} vs canon ${canon.token}`
        );
    }
    if (getAddress(asset.vault) !== getAddress(canon.vault)) {
        throw new Error(
            `${symbol} vault mismatch market ${asset.vault} vs canon ${canon.vault}`
        );
    }
    const decimals = asset.decimals;

    const weight = result.weights[symbol];
    if (typeof weight !== "number") {
        throw new Error(`no weight for ${symbol} in result.json`);
    }
    const usd = CAPITAL_USD * weight;
    const priceUsd = asset.priceUsd;
    const tokenAmount = tokenAmountFromUsd(usd, priceUsd, decimals);

    pricesOut[symbol] = {priceUsd, decimals};
    tokenAmountsOut[symbol] = {
        venueId: canon.venueId,
        weight,
        amountUsd: usd,
        priceUsd,
        decimals,
        tokenAmount: tokenAmount.toString(),
    };

    // Skip a venue if the amount rounds to 0 base units.
    if (tokenAmount === 0n) {
        tokenAmountsOut[symbol].skipped = true;
        continue;
    }
    deployedUsdSum += usd;

    // (a) approve(vault, tokenAmount) on the TOKEN
    const approveData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [getAddress(canon.vault), tokenAmount],
    });
    // (b) deposit(tokenAmount, RECEIVER) on the VAULT
    const depositData = encodeFunctionData({
        abi: erc4626Abi,
        functionName: "deposit",
        args: [tokenAmount, getAddress(RECEIVER)],
    });

    // ---- VERIFY: decode back and assert args match intent ----
    if (!approveData.startsWith(APPROVE_SELECTOR)) {
        throw new Error(`${symbol} approve selector wrong: ${approveData.slice(0, 10)}`);
    }
    if (!depositData.startsWith(DEPOSIT_SELECTOR)) {
        throw new Error(`${symbol} deposit selector wrong: ${depositData.slice(0, 10)}`);
    }
    const decA = decodeFunctionData({abi: erc20Abi, data: approveData});
    if (
        decA.functionName !== "approve" ||
        getAddress(decA.args[0]) !== getAddress(canon.vault) ||
        decA.args[1] !== tokenAmount
    ) {
        throw new Error(`${symbol} approve decode mismatch`);
    }
    const decD = decodeFunctionData({abi: erc4626Abi, data: depositData});
    if (
        decD.functionName !== "deposit" ||
        decD.args[0] !== tokenAmount ||
        getAddress(decD.args[1]) !== getAddress(RECEIVER)
    ) {
        throw new Error(`${symbol} deposit decode mismatch`);
    }

    txs.push({
        label: `approve ${symbol} -> Core ${symbol} vault`,
        venueId: canon.venueId,
        symbol,
        chainId: CHAIN_ID,
        from: SENDER,
        to: getAddress(canon.token),
        value: "0x0",
        data: approveData,
        decoded: {
            fn: "approve(address spender,uint256 amount)",
            args: {
                spender: getAddress(canon.vault),
                amount: tokenAmount.toString(),
            },
        },
        gasLimitSuggestion: "0xd6d8", // ~55000, standard ERC20 approve headroom
    });
    txs.push({
        label: `deposit ${symbol} into Core ${symbol} vault (ERC-4626)`,
        venueId: canon.venueId,
        symbol,
        chainId: CHAIN_ID,
        from: SENDER,
        to: getAddress(canon.vault),
        value: "0x0",
        data: depositData,
        decoded: {
            fn: "deposit(uint256 assets,address receiver)",
            args: {
                assets: tokenAmount.toString(),
                receiver: getAddress(RECEIVER),
            },
        },
        gasLimitSuggestion: "0x493e0", // ~300000, Morpho Vault V2 deposit headroom
    });
}

// ---------------------------------------------------------------------------
// Sanity checks.
// ---------------------------------------------------------------------------
const expectedDeployedUsd = CAPITAL_USD * (1 - result.reserve);
const drift = Math.abs(deployedUsdSum - expectedDeployedUsd);
// Tolerance: rounding of weights vs reserve in result.json (weights sum + reserve
// may not be exactly 1 due to independent rounding). Report but do not hard-fail
// beyond a loose bound.
const tol = CAPITAL_USD * 1e-3; // 0.1% of capital
const sanity = {
    capitalUsd: CAPITAL_USD,
    reserveFraction: result.reserve,
    reserveUsd: CAPITAL_USD * result.reserve,
    sumWeights: order.reduce((s, k) => s + (result.weights[k] || 0), 0),
    deployedUsdSum,
    expectedDeployedUsdFromReserve: expectedDeployedUsd,
    deployedVsReserveDriftUsd: drift,
    driftWithinTolerance: drift <= tol,
};

// Cross-check each computed tokenAmount against result.json.perVenue (informational).
const crosscheck = result.perVenue.map((pv) => {
    const mine = tokenAmountsOut[pv.symbol];
    const myWhole = Number(mine.tokenAmount) / Math.pow(10, mine.decimals);
    return {
        symbol: pv.symbol,
        optimizerTokenAmount: pv.tokenAmount,
        rebuiltWholeTokens: myWhole,
        rebuiltBaseUnits: mine.tokenAmount,
        absDiffWholeTokens: Math.abs(myWhole - pv.tokenAmount),
    };
});

// ---------------------------------------------------------------------------
// Assemble bundle.
// ---------------------------------------------------------------------------
const bundle = {
    header: {
        asOf: result.asOf,
        builtAt: new Date().toISOString(),
        chainId: CHAIN_ID,
        chainName: "Flare mainnet",
        capitalUsd: CAPITAL_USD,
        weightsSource: "optimizer/result.json",
        priceSource: "research/market-data.json",
        receiver: RECEIVER,
        receiverNote:
            "Placeholder curator address 0x00..01. Replace with the deployed CurationController / curator EOA before broadcast.",
        sender: SENDER,
        note: "UNSIGNED - prepared, not broadcast. Flare MAINNET (chainId 14). Review before signing.",
        reserveFraction: result.reserve,
        reserveUsdUndeployed: CAPITAL_USD * result.reserve,
        prices: pricesOut,
        tokenAmounts: tokenAmountsOut,
        sanity,
        crosscheck,
        conventions: {
            venueIds: {0: "FXRP", 1: "USDT0", 2: "WFLR"},
            approveSelector: APPROVE_SELECTOR,
            depositSelector: DEPOSIT_SELECTOR,
            ordering: "per venue: approve (token) then deposit (vault); venues in id order 0,1,2",
        },
        swapPrerequisite:
            "Capital is USD notional. Acquiring FXRP and WFLR from a stable (e.g. USDT0) requires a DEX swap FIRST (SparkDEX / Enosys on Flare). Router calldata is NOT included here (not verified). USDT0 deposit needs no swap.",
    },
    transactions: txs,
};

writeFileSync(
    join(HERE, "bundle.json"),
    JSON.stringify(bundle, null, 2) + "\n"
);

// ---------------------------------------------------------------------------
// Console report.
// ---------------------------------------------------------------------------
console.log("Prepared UNSIGNED bundle for Flare mainnet (chainId 14).");
console.log(`Capital: ${CAPITAL_USD} USD | reserve ${(result.reserve * 100).toFixed(2)}% undeployed`);
for (const symbol of order) {
    const t = tokenAmountsOut[symbol];
    console.log(
        `  ${symbol} (venue ${t.venueId}): weight ${t.weight} -> $${t.amountUsd.toFixed(2)} ` +
            `-> ${t.tokenAmount} base units (${t.decimals} dec)` +
            (t.skipped ? "  [SKIPPED: rounds to 0]" : "")
    );
}
console.log(`Deployed USD sum: ${deployedUsdSum.toFixed(2)} | expected (C*(1-reserve)): ${expectedDeployedUsd.toFixed(2)} | drift $${drift.toFixed(2)} | within tol: ${sanity.driftWithinTolerance}`);
console.log(`Transactions: ${txs.length} (${txs.length / 2} venues x approve+deposit)`);
console.log("All calldata selectors + decoded args verified.");
console.log("Wrote bundle.json");
