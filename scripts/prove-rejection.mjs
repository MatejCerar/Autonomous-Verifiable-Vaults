// SIGNED REJECTION PROOF (Coston2 broadcast twin of RejectUnauthorizedTee.t.sol).
//
// Produces a genuinely-signed transaction that carries a valid, bounded,
// enclave-signed allocation Plan, and proves that submitting it to a deployed
// CurationController REVERTS with "bad signer" - because the enclave that signed
// the plan is NOT the one registered in the mandate. No funds move.
//
// "Verify, don't trust": even a perfectly in-mandate plan from the wrong enclave
// is rejected on-chain, at check 5 of preimage.md (replay, bad nonce, expired,
// bad fingerprint, BAD SIGNER, then the cap checks). The plan carries the
// REGISTERED codeHash, controller.nonce(), and a future expiry with in-cap
// allocations, so the ONLY thing wrong is the signing key.
//
// Two signers, two roles (the honesty note):
//   - the ROGUE ENCLAVE key signs the PLAN (EIP-191 over the 32-byte planHash),
//   - a funded EOA (env PK) signs the TRANSACTION and pays gas.
// So it is a real, broadcastable, self-reverting transaction. Nothing moves.
//
// Flow:
//   1. read ../addresses.json (live deployment): controller, chainId, codeHash,
//      rpcUrl, plus the live controller.nonce().
//   2. rogue enclave key: env ROGUE_PK, else freshly generated (printed, labeled
//      throwaway).
//   3. build a valid bounded Plan (venues within the 30% cap, reserve >= 20%,
//      sums reconcile), sign its planHash with the rogue key.
//   4. eth_call / simulate -> decode + print the revert reason (expects
//      "bad signer").
//   5. write scripts/rejection-tx.signed.json (the raw signed tx hex + decoded
//      reason) as the artifact, WITHOUT requiring a broadcast.
//   6. if PK is set and BROADCAST=1, broadcast with an explicit gas limit so it
//      is mined despite reverting; print the reverted tx hash, an explorer link,
//      and confirm on-chain status = 0.
//
// No secrets hardcoded: PK and ROGUE_PK come from env only.
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath, pathToFileURL} from "node:url";
import {dirname, join} from "node:path";
import {createRequire} from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = join(__dirname, "..");

// viem lives in tee-model/node_modules (this scripts/ dir has none). Resolve it
// from there so the curator needs no separate install for scripts/.
const teeRequire = createRequire(
  pathToFileURL(join(DEMO_ROOT, "tee-model", "package.json"))
);
const viem = await import(pathToFileURL(teeRequire.resolve("viem")).href);
const viemAccounts = await import(
  pathToFileURL(teeRequire.resolve("viem/accounts")).href
);
const {
  createPublicClient,
  http,
  getAddress,
  encodeAbiParameters,
  decodeAbiParameters,
  encodePacked,
  encodeFunctionData,
  keccak256,
} = viem;
const {privateKeyToAccount, generatePrivateKey} = viemAccounts;

// Extract a human revert reason from a viem call error. Walks the cause chain
// for the raw revert data and decodes the standard Error(string) selector
// (0x08c379a0), falling back to viem's own messages.
function extractRevertReason(err) {
  let e = err;
  const seen = new Set();
  while (e && !seen.has(e)) {
    seen.add(e);
    let data = e?.data;
    if (typeof data === "object" && data?.data) data = data.data;
    if (
      typeof data === "string" &&
      data.startsWith("0x08c379a0") &&
      data.length >= 138
    ) {
      try {
        const [reason] = decodeAbiParameters(
          [{type: "string"}],
          ("0x" + data.slice(10))
        );
        if (reason) return reason;
      } catch {
        // fall through
      }
    }
    if (e?.reason) return e.reason;
    e = e?.cause;
  }
  const m = /reverted with the following reason:\s*\n?\s*(.+)/i.exec(
    err?.message || ""
  );
  if (m) return m[1].trim();
  return err?.shortMessage || err?.details || err?.message || String(err);
}

const ADDRESSES_FILE = join(DEMO_ROOT, "addresses.json");
const ARTIFACT_FILE = join(__dirname, "rejection-tx.signed.json");

// --- 1. live deployment ---
const addresses = JSON.parse(readFileSync(ADDRESSES_FILE, "utf8"));
const controllerRaw = addresses?.deployed?.curationController;
if (!controllerRaw || controllerRaw === "") {
  process.stderr.write(
    "addresses.json has no deployed.curationController; deploy first " +
      "(scripts/deploy-testnet.sh)\n"
  );
  process.exit(2);
}
const controller = getAddress(controllerRaw);
const rpcUrl = process.env.RPC || addresses.rpcUrl;
const registeredCodeHash = addresses.codeHash;
if (!registeredCodeHash || registeredCodeHash === "") {
  process.stderr.write("addresses.json has no codeHash; deploy first\n");
  process.exit(2);
}
const modelVersion = BigInt(addresses.modelVersion ?? "1");

const publicClient = createPublicClient({transport: http(rpcUrl)});
const chainId = await publicClient.getChainId();

// --- controller ABI (executePlan + the reads we need) ---
const allocationTuple = {
  name: "allocations",
  type: "tuple[]",
  components: [
    {name: "venueId", type: "uint256"},
    {name: "amount", type: "uint256"},
  ],
};
const planTuple = {
  name: "plan",
  type: "tuple",
  components: [
    {name: "planId", type: "bytes32"},
    {name: "modelVersion", type: "uint256"},
    {name: "codeHash", type: "bytes32"},
    {name: "nonce", type: "uint256"},
    {name: "expiry", type: "uint256"},
    {name: "totalOut", type: "uint256"},
    {name: "reserveAmount", type: "uint256"},
    allocationTuple,
  ],
};
const controllerAbi = [
  {
    type: "function",
    name: "executePlan",
    stateMutability: "nonpayable",
    inputs: [planTuple, {name: "signature", type: "bytes"}],
    outputs: [],
  },
  {
    type: "function",
    name: "nonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "vault",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "address"}],
  },
];
const vaultReadAbi = [
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "uint256"}],
  },
];

// live on-chain nonce and TVL (so allocations respect the actual caps).
const onchainNonce = await publicClient.readContract({
  address: controller,
  abi: controllerAbi,
  functionName: "nonce",
});
const vaultAddr = await publicClient.readContract({
  address: controller,
  abi: controllerAbi,
  functionName: "vault",
});
const tvl = await publicClient.readContract({
  address: vaultAddr,
  abi: vaultReadAbi,
  functionName: "totalAssets",
});

// --- 2. rogue enclave key (env or freshly generated throwaway) ---
let rogueKey = process.env.ROGUE_PK;
let rogueGenerated = false;
if (rogueKey) {
  rogueKey = rogueKey.startsWith("0x") ? rogueKey : "0x" + rogueKey;
} else {
  rogueKey = generatePrivateKey();
  rogueGenerated = true;
}
const rogueAccount = privateKeyToAccount(rogueKey);

// --- 3. build a VALID, bounded plan ---
// Allocations within the 30% venue cap, reserve above the 20% floor, sums
// reconcile with totalOut. Amounts are the optimizer weights (result.json)
// scaled to the live TVL, clamped to be strictly in-cap; the reserve absorbs
// the remainder so no cap is touched. This is a plan the mandate would accept -
// the ONLY defect is the signer.
const VENUE_CAP_BIPS = 3000n; // 30% (must match the registry mandate)
const MIN_RESERVE_BIPS = 2000n; // 20% floor
// A safely in-cap per-venue slice (20% each, well under the 30% cap).
const perVenue = (tvl * 2000n) / 10000n;
const allocations = [
  {venueId: 0n, amount: perVenue},
  {venueId: 1n, amount: perVenue},
  {venueId: 2n, amount: perVenue},
];
// Reserve = 20% (== floor). totalOut = 3*20% + 20% = 80% (<= 100% total cap).
const reserveAmount = (tvl * 2000n) / 10000n;
const totalOut = perVenue * 3n + reserveAmount;

// planId unique per run so replay never masks the "bad signer" reason.
const planId = keccak256(
  encodePacked(
    ["string", "uint256", "address"],
    ["rogue-rejection-proof", onchainNonce, rogueAccount.address]
  )
);
const nowSec = BigInt(Math.floor(Date.now() / 1000));
const expiry = nowSec + 3600n; // 1h in the future

const plan = {
  planId,
  modelVersion,
  codeHash: registeredCodeHash, // the REGISTERED fingerprint: check 4 passes
  nonce: onchainNonce, // live nonce: check 2 passes
  expiry, // future: check 3 passes
  totalOut,
  reserveAmount,
  allocations,
};

// --- planHash per preimage.md (domain sep = controller + chainId), then sign
//     with the rogue enclave key (EIP-191 personal_sign over the raw 32-byte
//     hash). This is byte-identical to PlanLib.hashPlan. ---
const allocHash = keccak256(
  encodeAbiParameters(
    [
      {
        type: "tuple[]",
        components: [
          {name: "venueId", type: "uint256"},
          {name: "amount", type: "uint256"},
        ],
      },
    ],
    [plan.allocations]
  )
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
      controller,
      BigInt(chainId),
      plan.planId,
      plan.modelVersion,
      plan.codeHash,
      plan.nonce,
      plan.expiry,
      plan.totalOut,
      plan.reserveAmount,
      allocHash,
    ]
  )
);
const signature = await rogueAccount.signMessage({message: {raw: planHash}});

// --- diagnostics ---
process.stderr.write(`controller:        ${controller}\n`);
process.stderr.write(`rpc:               ${rpcUrl}\n`);
process.stderr.write(`chainId:           ${chainId}\n`);
process.stderr.write(`registered codeHash (mandate): ${registeredCodeHash}\n`);
process.stderr.write(`live nonce:        ${onchainNonce}\n`);
process.stderr.write(`vault TVL:         ${tvl}\n`);
process.stderr.write(
  `ROGUE enclave signer (NOT registered${
    rogueGenerated ? ", freshly generated throwaway" : ", from ROGUE_PK"
  }): ${rogueAccount.address}\n`
);
process.stderr.write(`planId:            ${plan.planId}\n`);
process.stderr.write(`planHash:          ${planHash}\n`);
process.stderr.write(`plan signature:    ${signature}\n`);

// The executePlan calldata (identical whether we simulate or broadcast).
const calldata = encodeFunctionData({
  abi: controllerAbi,
  functionName: "executePlan",
  args: [plan, signature],
});

// --- 4. simulate (eth_call): decode + print the revert reason ---
let revertReason = null;
try {
  await publicClient.call({to: controller, data: calldata});
  process.stderr.write(
    "\nUNEXPECTED: eth_call did NOT revert. A rogue-signed plan should be " +
      'rejected with "bad signer".\n'
  );
  process.exit(1);
} catch (err) {
  revertReason = extractRevertReason(err);
  process.stderr.write(`\neth_call simulation reverted (expected):\n`);
  process.stderr.write(`  ${revertReason}\n`);
  if (!/bad signer/i.test(revertReason)) {
    process.stderr.write(
      '\nWARNING: expected "bad signer" but got the above. Check that the ' +
        "plan carries the registered codeHash and a valid nonce/expiry.\n"
    );
  } else {
    process.stderr.write('  -> confirmed: "bad signer" (wrong enclave)\n');
  }
}

// --- 5. artifact: raw SIGNED tx hex + decoded reason, no broadcast needed ---
// Sign the transaction with the EOA (env PK) if available, else record the
// unsigned calldata so the artifact is always produced.
const PK = process.env.PK;
let signedTxHex = null;
let eoaAddress = null;
const gasLimit = 500000n; // explicit, so a reverting tx still mines

if (PK) {
  const pk = PK.startsWith("0x") ? PK : "0x" + PK;
  const eoa = privateKeyToAccount(pk);
  eoaAddress = eoa.address;
  const txNonce = await publicClient.getTransactionCount({
    address: eoa.address,
  });
  const gasPrice = await publicClient.getGasPrice();
  // Legacy tx (Coston2 accepts legacy); explicit gas so the revert is mined.
  signedTxHex = await eoa.signTransaction({
    to: controller,
    data: calldata,
    gas: gasLimit,
    gasPrice,
    nonce: txNonce,
    value: 0n,
    chainId: Number(chainId),
    type: "legacy",
  });
}

const artifact = {
  what: "SIGNED REJECTION PROOF: an in-mandate plan from the WRONG enclave.",
  controller,
  chainId,
  rpcUrl,
  registeredCodeHash,
  rogueEnclaveSigner: rogueAccount.address,
  rogueEnclaveKeyIsThrowaway: rogueGenerated,
  eoaSignerOfTx: eoaAddress,
  plan: {
    planId: plan.planId,
    modelVersion: plan.modelVersion.toString(),
    codeHash: plan.codeHash,
    nonce: plan.nonce.toString(),
    expiry: plan.expiry.toString(),
    totalOut: plan.totalOut.toString(),
    reserveAmount: plan.reserveAmount.toString(),
    allocations: plan.allocations.map((a) => ({
      venueId: a.venueId.toString(),
      amount: a.amount.toString(),
    })),
  },
  planHash,
  planSignature: signature,
  calldata,
  gasLimit: gasLimit.toString(),
  signedTx: signedTxHex,
  simulatedRevertReason: revertReason,
  note:
    "The EOA (PK) signs and pays for the transaction; the rogue enclave key " +
    "signs the plan. Nothing moves: executePlan reverts at check 5 " +
    '("bad signer") before any adapter.allocate.',
};
writeFileSync(ARTIFACT_FILE, JSON.stringify(artifact, null, 2) + "\n");
process.stderr.write(`\nartifact written: ${ARTIFACT_FILE}\n`);
if (!signedTxHex) {
  process.stderr.write(
    "  (signedTx is null: set PK to include the raw signed tx hex)\n"
  );
}

// --- 6. optional real broadcast (mined, reverted) ---
if (process.env.BROADCAST === "1") {
  if (!signedTxHex) {
    process.stderr.write(
      "\nBROADCAST=1 but PK is not set; cannot broadcast. Set PK (funded EOA).\n"
    );
    process.exit(2);
  }
  process.stderr.write(
    `\nBROADCAST=1: sending the signed, self-reverting tx (EOA ${eoaAddress} pays gas) ...\n`
  );
  const hash = await publicClient.sendRawTransaction({
    serializedTransaction: signedTxHex,
  });
  process.stdout.write(`reverted txHash: ${hash}\n`);
  const explorer = `https://coston2.testnet.flarescan.com/tx/${hash}`;
  process.stdout.write(`explorer:        ${explorer}\n`);
  const receipt = await publicClient.waitForTransactionReceipt({hash});
  process.stdout.write(`status:          ${receipt.status}\n`);
  if (receipt.status === "reverted" || receipt.status === 0) {
    process.stdout.write(
      '  -> mined and REVERTED as expected (status 0). "bad signer": the ' +
        "wrong enclave was rejected on-chain. No funds moved.\n"
    );
  } else {
    process.stderr.write(
      "\nUNEXPECTED: broadcast tx did NOT revert. Investigate.\n"
    );
    process.exit(1);
  }
} else {
  process.stderr.write(
    "\n(dry run: set PK and BROADCAST=1 to actually mine the reverted tx.)\n"
  );
}
