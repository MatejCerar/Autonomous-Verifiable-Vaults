// Submit ONE curation cycle on-chain from a signed envelope produced by the
// tee-model `run` command. Reads:
//   - the signed envelope JSON from argv[2] (default /tmp/plan.json),
//   - the active deployment from ../addresses.json (relative to this file),
//   - the deployer key from env PK, optional RPC from env RPC.
// Encodes controller.executePlan(Plan, signature) and sends it with viem. On a
// revert (e.g. the over-cap plan) it prints the on-chain revert reason and exits
// non-zero, which is exactly what `cycle.sh --bad` relies on to show a rejection.
//
// No secrets are hardcoded: PK comes from the environment.
import {readFileSync} from "node:fs";
import {fileURLToPath, pathToFileURL} from "node:url";
import {dirname, join} from "node:path";
import {createRequire} from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = join(__dirname, "..");

// viem lives in tee-model/node_modules (this scripts/ dir has none). Resolve it
// from there so the curator does not need a separate install for scripts/.
const teeRequire = createRequire(
  pathToFileURL(join(DEMO_ROOT, "tee-model", "package.json"))
);
const viem = await import(pathToFileURL(teeRequire.resolve("viem")).href);
const viemAccounts = await import(
  pathToFileURL(teeRequire.resolve("viem/accounts")).href
);
const {createWalletClient, createPublicClient, http, getAddress} = viem;
const {privateKeyToAccount} = viemAccounts;
const ADDRESSES_FILE = join(DEMO_ROOT, "addresses.json");

const planPath = process.argv[2] || "/tmp/plan.json";

const PK = process.env.PK;
if (!PK) {
  process.stderr.write("PK env var is required (deployer private key)\n");
  process.exit(2);
}
const pk = PK.startsWith("0x") ? PK : "0x" + PK;

const addresses = JSON.parse(readFileSync(ADDRESSES_FILE, "utf8"));
const controller = addresses?.deployed?.curationController;
if (!controller || controller === "") {
  process.stderr.write(
    "addresses.json has no deployed.curationController; deploy first\n"
  );
  process.exit(2);
}
const rpcUrl = process.env.RPC || addresses.rpcUrl;

const envelope = JSON.parse(readFileSync(planPath, "utf8"));
const p = envelope.plan;
const plan = {
  planId: p.planId,
  modelVersion: BigInt(p.modelVersion),
  codeHash: p.codeHash,
  nonce: BigInt(p.nonce),
  expiry: BigInt(p.expiry),
  totalOut: BigInt(p.totalOut),
  reserveAmount: BigInt(p.reserveAmount),
  allocations: p.allocations.map((a) => ({
    venueId: BigInt(a.venueId),
    amount: BigInt(a.amount),
  })),
};
const signature = envelope.signature;

// Minimal ABI: executePlan + the reads we print afterwards.
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
  {
    type: "function",
    name: "reserveAdapter",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "address"}],
  },
  {
    type: "function",
    name: "adapterCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "adapters",
    stateMutability: "view",
    inputs: [{name: "venueId", type: "uint256"}],
    outputs: [{type: "address"}],
  },
];
const balOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{name: "holder", type: "address"}],
    outputs: [{type: "uint256"}],
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

const account = privateKeyToAccount(pk);
const publicClient = createPublicClient({transport: http(rpcUrl)});
const walletClient = createWalletClient({account, transport: http(rpcUrl)});

const controllerAddr = getAddress(controller);

process.stderr.write(`controller: ${controllerAddr}\n`);
process.stderr.write(`rpc:        ${rpcUrl}\n`);
process.stderr.write(`planId:     ${plan.planId}\n`);
process.stderr.write(`nonce:      ${plan.nonce}\n`);
process.stderr.write(`totalOut:   ${plan.totalOut}\n`);

try {
  const hash = await walletClient.writeContract({
    address: controllerAddr,
    abi: controllerAbi,
    functionName: "executePlan",
    args: [plan, signature],
    chain: null,
  });
  process.stdout.write(`txHash: ${hash}\n`);
  const receipt = await publicClient.waitForTransactionReceipt({hash});
  process.stdout.write(`status: ${receipt.status}\n`);

  // Print resulting on-chain positions.
  const vaultAddr = await publicClient.readContract({
    address: controllerAddr,
    abi: controllerAbi,
    functionName: "vault",
  });
  const reserveAddr = await publicClient.readContract({
    address: controllerAddr,
    abi: controllerAbi,
    functionName: "reserveAdapter",
  });
  const count = await publicClient.readContract({
    address: controllerAddr,
    abi: controllerAbi,
    functionName: "adapterCount",
  });
  const tvl = await publicClient.readContract({
    address: vaultAddr,
    abi: vaultReadAbi,
    functionName: "totalAssets",
  });
  process.stdout.write(`\nresulting positions:\n`);
  process.stdout.write(`  vault TVL:     ${tvl}\n`);
  for (let i = 0n; i < count; i++) {
    const adapter = await publicClient.readContract({
      address: controllerAddr,
      abi: controllerAbi,
      functionName: "adapters",
      args: [i],
    });
    const bal = await publicClient.readContract({
      address: adapter,
      abi: balOfAbi,
      functionName: "balanceOf",
      args: [vaultAddr],
    });
    process.stdout.write(`  venue ${i} (${adapter}): ${bal}\n`);
  }
  const reserveBal = await publicClient.readContract({
    address: reserveAddr,
    abi: balOfAbi,
    functionName: "balanceOf",
    args: [vaultAddr],
  });
  process.stdout.write(`  reserve (${reserveAddr}): ${reserveBal}\n`);
} catch (err) {
  const reason =
    err?.shortMessage || err?.details || err?.message || String(err);
  process.stderr.write(`\nexecutePlan REVERTED (expected for --bad):\n`);
  process.stderr.write(`  ${reason}\n`);
  process.exit(1);
}
