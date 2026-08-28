// Real Flare TEE path for the AVV demo.
//
// This is the second, opt-in action ("Run this cycle in the real Flare TEE").
// It sends the current market snapshot to a deployed InstructionSender contract
// on Coston2, the enclave (tee-node) runs the SAME AVV optimizer inside a TEE,
// signs the resulting bounded Plan, and the ext-proxy serves the signed result.
// We derive the instructionId from the tx receipt, poll for the result, and
// decode the enclave-signed PlanLib.Plan tuple.
//
// The client-side "Start cycle" path in live.ts is unaffected and always works.
// Everything here degrades gracefully: unconfigured -> disabled; unreachable ->
// a clear error the caller surfaces as "showing the client-side result".
//
// No emojis, no em dashes (house style).

import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  decodeAbiParameters,
  encodeAbiParameters,
  encodePacked,
  keccak256,
  toHex,
  stringToHex,
  type Account,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  INSTRUCTION_SENDER,
  ALLOCATION_DISPLAY,
  CURATION_CONTROLLER,
  CURATION_CONTROLLER_ABI,
  DEMO_SIGNER_KEY,
  SIMULATED_TEE_SIGNER_KEY,
  EXT_PROXY_URL,
  GATEWAY_URL,
  INSTRUCTION_FEE,
  CURATION_OPTYPE,
  CURATION_OPCOMMAND,
  COSTON2,
  RESULT_POLL,
  teeConfigured,
  gatewayConfigured,
  demoSignerConfigured,
} from "@/tee.config";

// --------------------------------------------------------------------------
// ABIs
// --------------------------------------------------------------------------

// The single custom entry point the deploy engineer adds to InstructionSender.sol
// (see README section (c)). It forwards msg.value as the instruction fee.
export const INSTRUCTION_SENDER_ABI = [
  {
    type: "function",
    name: "sendCuration",
    stateMutability: "payable",
    inputs: [{ name: "_message", type: "bytes" }],
    outputs: [],
  },
] as const;

// TeeInstructionsSent, emitted by the TeeExtensionRegistry (FlareTeeManager
// diamond) when sendInstructions runs. Copied field-for-field from the
// flare-smart-contracts-v2 ABI (see go-flare-common machinemanager autogen).
// instructionId is the 2nd indexed topic; that is what the ext-proxy keys on.
//   TeeInstructionsSent(
//     uint256 indexed extensionId,
//     bytes32 indexed instructionId,
//     uint32  indexed rewardEpochId,
//     TeeMachine[] teeMachines, bytes32 opType, bytes32 opCommand, bytes message,
//     address[] cosigners, uint64 cosignersThreshold, address claimBackAddress,
//     uint256 fee)
export const TEE_INSTRUCTIONS_SENT_EVENT = {
  type: "event",
  name: "TeeInstructionsSent",
  inputs: [
    { name: "extensionId", type: "uint256", indexed: true },
    { name: "instructionId", type: "bytes32", indexed: true },
    { name: "rewardEpochId", type: "uint32", indexed: true },
    {
      name: "teeMachines",
      type: "tuple[]",
      indexed: false,
      components: [
        { name: "teeId", type: "address" },
        { name: "teeProxyId", type: "address" },
        { name: "url", type: "string" },
      ],
    },
    { name: "opType", type: "bytes32", indexed: false },
    { name: "opCommand", type: "bytes32", indexed: false },
    { name: "message", type: "bytes", indexed: false },
    { name: "cosigners", type: "address[]", indexed: false },
    { name: "cosignersThreshold", type: "uint64", indexed: false },
    { name: "claimBackAddress", type: "address", indexed: false },
    { name: "fee", type: "uint256", indexed: false },
  ],
} as const;

// PlanLib.Plan tuple. Same layout the extension encodes as ActionResult.data
// (see fcc-scaffold typescript/src/app/avv.ts PLAN_ABI).
export const PLAN_ABI = [
  {
    type: "tuple",
    components: [
      { name: "planId", type: "bytes32" },
      { name: "modelVersion", type: "uint256" },
      { name: "codeHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "totalOut", type: "uint256" },
      { name: "reserveAmount", type: "uint256" },
      {
        name: "allocations",
        type: "tuple[]",
        components: [
          { name: "venueId", type: "uint256" },
          { name: "amount", type: "uint256" },
        ],
      },
    ],
  },
] as const;

export interface DecodedAllocation {
  venueId: bigint;
  amount: bigint;
}

export interface DecodedPlan {
  planId: Hex;
  modelVersion: bigint;
  codeHash: Hex;
  nonce: bigint;
  expiry: bigint;
  totalOut: bigint;
  reserveAmount: bigint;
  allocations: readonly DecodedAllocation[];
}

/** The enclave result: the bounded Plan plus the enclave signature over it. */
export interface DecodedPlanSig {
  plan: DecodedPlan;
  signature: Hex;
}

// The enclave now returns abi.encode(Plan, bytes signature), so we decode the
// Plan tuple AND the trailing signature. PLAN_ABI[0] is the Plan tuple param.
export const PLAN_SIG_ABI = [
  PLAN_ABI[0],
  { name: "signature", type: "bytes" },
] as const;

// AllocationDisplay "display vault" (see onchain/src/AllocationDisplay.sol). The
// demo relayer writes the accepted Plan with pushCycle; the frontend reads it
// back with latest() + cycleCount() to render the on-chain panel.
export const ALLOCATION_DISPLAY_ABI = [
  {
    type: "function",
    name: "pushCycle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "planId", type: "bytes32" },
      { name: "totalOut", type: "uint256" },
      { name: "reserveAmount", type: "uint256" },
      { name: "amounts", type: "uint256[3]" },
    ],
    outputs: [{ name: "cycleId", type: "uint256" }],
  },
  {
    type: "function",
    name: "cycleCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "latest",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "planId", type: "bytes32" },
          { name: "totalOut", type: "uint256" },
          { name: "reserveAmount", type: "uint256" },
          { name: "amounts", type: "uint256[3]" },
          { name: "timestamp", type: "uint64" },
          { name: "cycleId", type: "uint256" },
        ],
      },
    ],
  },
] as const;

/** Decoded AllocationDisplay.latest() Cycle struct. */
export interface OnChainCycle {
  planId: Hex;
  totalOut: bigint;
  reserveAmount: bigint;
  amounts: readonly [bigint, bigint, bigint];
  timestamp: bigint;
  cycleId: bigint;
}

// --------------------------------------------------------------------------
// Chain + wallet
// --------------------------------------------------------------------------

const coston2Chain = {
  id: COSTON2.chainId,
  name: COSTON2.name,
  nativeCurrency: COSTON2.nativeCurrency,
  rpcUrls: { default: { http: [COSTON2.rpcUrl] } },
  blockExplorers: {
    default: { name: "Coston2 Explorer", url: COSTON2.explorer },
  },
} as const;

/** viem PublicClient bound to the Coston2 RPC for reads + receipt waits. */
export function makeCoston2Client(): PublicClient {
  return createPublicClient({
    chain: coston2Chain,
    transport: http(COSTON2.rpcUrl),
  }) as PublicClient;
}

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

function injected(): Eip1193 {
  const eth = (globalThis as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) throw new Error("No injected wallet found. Install MetaMask.");
  return eth;
}

/** Add Coston2 to the wallet if missing, then switch to it (EIP-3085/3326). */
export async function ensureCoston2(eth: Eip1193): Promise<void> {
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: COSTON2.chainIdHex }],
    });
  } catch (e) {
    // 4902 = chain not added. Add it, then it is selected.
    const code = (e as { code?: number }).code;
    if (code === 4902 || /unrecognized|not been added/i.test(String((e as Error).message))) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: COSTON2.chainIdHex,
            chainName: COSTON2.name,
            nativeCurrency: COSTON2.nativeCurrency,
            rpcUrls: [COSTON2.rpcUrl],
            blockExplorerUrls: [COSTON2.explorer],
          },
        ],
      });
    } else {
      throw e;
    }
  }
}

/** Connect the injected wallet and ensure it is on Coston2. Returns the account. */
export async function connectCoston2(): Promise<{
  wallet: WalletClient;
  account: Hex;
  signer: Account | Hex;
}> {
  const eth = injected();
  const accounts = (await eth.request({
    method: "eth_requestAccounts",
  })) as Hex[];
  if (!accounts || accounts.length === 0) {
    throw new Error("Wallet returned no accounts.");
  }
  await ensureCoston2(eth);
  const wallet = createWalletClient({
    account: accounts[0],
    chain: coston2Chain,
    transport: custom(eth as never),
  });
  // Injected wallet signs via the node/extension, so the address string is the
  // right `account` value for writeContract.
  return { wallet, account: accounts[0], signer: accounts[0] };
}

/**
 * Build a WalletClient from the throwaway DEMO_SIGNER_KEY local account. Used
 * when the demo runs with no wallet popup (the FE signs both txs itself). Both
 * sendCuration and pushCycle are then sent from this relayer key, which MUST be
 * the AllocationDisplay updater. Returns null when no key is configured.
 */
export function demoSignerWallet(): {
  wallet: WalletClient;
  account: Hex;
  signer: Account | Hex;
} | null {
  if (!demoSignerConfigured()) return null;
  const acct: Account = privateKeyToAccount(DEMO_SIGNER_KEY as Hex);
  const wallet = createWalletClient({
    account: acct,
    chain: coston2Chain,
    transport: http(COSTON2.rpcUrl),
  });
  // The local key signs in-browser, so writeContract MUST receive the Account
  // OBJECT (not the address string). Passing the address string makes viem try
  // eth_sendTransaction on the public RPC, which fails with "unknown account".
  return { wallet, account: acct.address, signer: acct };
}

/**
 * Resolve the signer for the on-chain writes. Prefers the throwaway demo signer
 * (no wallet popup); falls back to the injected wallet on Coston2. `signer` is
 * what writeContract must use (Account object for the local key, address string
 * for the injected wallet); `account` is the address for display/return.
 */
async function resolveSigner(): Promise<{
  wallet: WalletClient;
  account: Hex;
  signer: Account | Hex;
}> {
  const demo = demoSignerWallet();
  if (demo) return demo;
  return connectCoston2();
}

// --------------------------------------------------------------------------
// Message encoding
// --------------------------------------------------------------------------

/**
 * Encode a market snapshot as the hex-of-UTF-8-JSON the enclave consumes, OR
 * "0x" to let the enclave use its bundled snapshot. This is exactly the double
 * encoding the extension contract expects: the on-chain `message` bytes are the
 * UTF-8 JSON of the research-schema snapshot (assets[] + pairwiseCorrelation).
 */
export function encodeSnapshotMessage(snapshot: unknown | null): Hex {
  if (snapshot == null) return "0x";
  return stringToHex(JSON.stringify(snapshot));
}

/**
 * Encode the enclave instruction message as hex-of-UTF-8-JSON
 * {"market": <snapshot>, "nonce": "<controller.nonce() as decimal string>"}.
 * The enclave binds the signed Plan to this nonce so CurationController.executePlan
 * accepts it exactly once. The nonce is a decimal string to survive JSON (no
 * bigint truncation).
 */
export function encodeCurationMessage(
  snapshot: unknown | null,
  nonce: bigint,
): Hex {
  return stringToHex(
    JSON.stringify({ market: snapshot ?? null, nonce: nonce.toString() }),
  );
}

// --------------------------------------------------------------------------
// instructionId derivation from the receipt
// --------------------------------------------------------------------------

// Compute topic0 lazily so we do not depend on a hardcoded hash that could drift
// if the event signature ever changes. keccak256 of the canonical signature.
let cachedTopic0: Hex | null = null;
async function instructionsSentTopic0(): Promise<Hex> {
  if (cachedTopic0) return cachedTopic0;
  const { toEventSelector } = await import("viem");
  cachedTopic0 = toEventSelector(
    "TeeInstructionsSent(uint256,bytes32,uint32,(address,address,string)[],bytes32,bytes32,bytes,address[],uint64,address,uint256)",
  );
  return cachedTopic0;
}

/**
 * Derive the instructionId from a mined tx receipt.
 *
 * The Go tooling reads it from the TeeInstructionsSent event
 * (event.InstructionId, receipt.Logs[0] in the scaffold). We do the same, but
 * robustly: find the log whose topic0 matches TeeInstructionsSent, decode it,
 * and return the (indexed) instructionId. Falling back to Logs[0] would break if
 * a fee/transfer log is emitted first, so we match by signature instead.
 */
export async function instructionIdFromLogs(logs: readonly Log[]): Promise<Hex> {
  const topic0 = await instructionsSentTopic0();
  const { decodeEventLog } = await import("viem");
  for (const log of logs) {
    if (!log.topics || log.topics[0]?.toLowerCase() !== topic0.toLowerCase()) {
      continue;
    }
    try {
      const decoded = decodeEventLog({
        abi: [TEE_INSTRUCTIONS_SENT_EVENT],
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const args = decoded.args as unknown as { instructionId: Hex };
      if (args.instructionId) return args.instructionId;
    } catch {
      // not our event shape; keep scanning
    }
  }
  // Fallback: the instructionId is the 2nd indexed topic of the event. If decode
  // failed but topic0 matched, topics[2] is still the raw bytes32 instructionId.
  for (const log of logs) {
    if (log.topics?.[0]?.toLowerCase() === topic0.toLowerCase() && log.topics[2]) {
      return log.topics[2] as Hex;
    }
  }
  throw new Error(
    "TeeInstructionsSent event not found in tx receipt. Is INSTRUCTION_SENDER pointing at a registered extension?",
  );
}

// --------------------------------------------------------------------------
// ext-proxy result polling + Plan decode
// --------------------------------------------------------------------------

// ActionResult status codes (docs/extension-contract.md 4.6):
//   1 = success, 0 = error, anything else (2) = pending.
export interface ActionResultJson {
  id: Hex;
  submissionTag: string;
  status: number;
  log: string;
  opType: Hex;
  opCommand: Hex;
  additionalResultStatus: Hex;
  version: string;
  data: Hex; // "0x" until status == 1
}

export interface TeeResult {
  instructionId: Hex;
  plan: DecodedPlan;
  /** The enclave signature over the Plan (empty "0x" for the local path). */
  signature: Hex;
  raw: ActionResultJson;
  resultUrl: string;
}

function resultUrl(instructionId: Hex): string {
  const base = EXT_PROXY_URL.replace(/\/+$/, "");
  return `${base}/action/result/${instructionId}`;
}

/** Decode ActionResult.data as the PlanLib.Plan tuple. */
export function decodePlan(data: Hex): DecodedPlan {
  const [decoded] = decodeAbiParameters(PLAN_ABI, data);
  return decoded as unknown as DecodedPlan;
}

/**
 * Decode ActionResult.data as abi.encode(Plan, bytes signature). The enclave now
 * signs the bounded Plan and returns both, so the frontend can enforce it via
 * CurationController.executePlan(plan, signature).
 */
export function decodePlanSig(data: Hex): DecodedPlanSig {
  const [plan, signature] = decodeAbiParameters(PLAN_SIG_ABI, data);
  return {
    plan: plan as unknown as DecodedPlan,
    signature: signature as Hex,
  };
}

/**
 * Poll `${EXT_PROXY_URL}/action/result/${instructionId}` until the status is
 * final (1 success / 0 error) or the timeout elapses while pending (status 2).
 * On success, decode the enclave-signed Plan from result.data.
 */
export async function pollResult(instructionId: Hex): Promise<TeeResult> {
  const url = resultUrl(instructionId);
  const deadline = Date.now() + RESULT_POLL.timeoutMs;
  let lastErr: string | undefined;

  while (Date.now() < deadline) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { accept: "application/json" } });
    } catch (e) {
      lastErr = `ext-proxy unreachable: ${(e as Error).message}`;
      await sleep(RESULT_POLL.intervalMs);
      continue;
    }

    if (res.status === 404) {
      // Not indexed yet: keep polling.
      await sleep(RESULT_POLL.intervalMs);
      continue;
    }
    if (!res.ok) {
      lastErr = `ext-proxy returned HTTP ${res.status}`;
      await sleep(RESULT_POLL.intervalMs);
      continue;
    }

    // The ext-proxy wraps the ActionResult under a `result` key
    // ({"result": {...}}); older builds returned it at the top level. Accept both.
    const body = (await res.json()) as
      | ActionResultJson
      | { result: ActionResultJson };
    const raw = (
      body && typeof body === "object" && "result" in body
        ? (body as { result: ActionResultJson }).result
        : body
    ) as ActionResultJson;

    if (raw.status === 1) {
      if (!raw.data || raw.data === "0x") {
        throw new Error("TEE reported success but returned empty result data.");
      }
      const { plan, signature } = decodePlanSig(raw.data);
      return { instructionId, plan, signature, raw, resultUrl: url };
    }
    if (raw.status === 0) {
      throw new Error(`TEE handler failed: ${raw.log || "unknown error"}`);
    }
    // status 2 (or anything else) = pending; keep polling.
    await sleep(RESULT_POLL.intervalMs);
  }

  throw new Error(
    `Timed out after ${RESULT_POLL.timeoutMs / 1000}s waiting for the TEE result` +
      (lastErr ? ` (${lastErr})` : "") +
      `. See ${url}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --------------------------------------------------------------------------
// Top-level orchestration
// --------------------------------------------------------------------------

/** The on-chain read-back of the display vault after pushCycle. */
export interface OnChainDisplay {
  cycle: OnChainCycle;
  cycleCount: bigint;
  pushTxHash: Hex;
  contract: Hex;
}

export interface RunTeeResult extends TeeResult {
  txHash: Hex;
  account: Hex;
  /** Present only when ALLOCATION_DISPLAY is configured and the write ran. */
  display?: OnChainDisplay;
  /** "tee" = computed in the live enclave; "local" = computed client-side. */
  mode: "tee" | "local";
}

/** Coarse step labels the UI renders as live status. */
export type TeeStep =
  | "submitting-instruction"
  | "waiting-for-enclave"
  | "writing-on-chain"
  | "reading-on-chain"
  | "done";

export interface RunTeeOptions {
  feeOverride?: bigint;
  onStep?: (step: TeeStep) => void;
}

/**
 * Map the decoded Plan allocations to the fixed [FXRP, USDT0, WFLR] vector the
 * display vault stores. Missing venues default to 0. Amounts are USD 1e18.
 */
export function planAmountsVector(plan: DecodedPlan): [bigint, bigint, bigint] {
  const byVenue = new Map<bigint, bigint>();
  for (const a of plan.allocations) {
    byVenue.set(a.venueId, (byVenue.get(a.venueId) ?? 0n) + a.amount);
  }
  return [
    byVenue.get(0n) ?? 0n,
    byVenue.get(1n) ?? 0n,
    byVenue.get(2n) ?? 0n,
  ];
}

/**
 * Read AllocationDisplay.latest() + cycleCount() from chain.
 */
export async function readDisplay(
  pub: PublicClient,
): Promise<{ cycle: OnChainCycle; cycleCount: bigint }> {
  const [cycle, cycleCount] = await Promise.all([
    pub.readContract({
      address: ALLOCATION_DISPLAY as Hex,
      abi: ALLOCATION_DISPLAY_ABI,
      functionName: "latest",
    }),
    pub.readContract({
      address: ALLOCATION_DISPLAY as Hex,
      abi: ALLOCATION_DISPLAY_ABI,
      functionName: "cycleCount",
    }),
  ]);
  return {
    cycle: cycle as unknown as OnChainCycle,
    cycleCount: cycleCount as bigint,
  };
}

/**
 * Build a synthetic OnChainCycle from an executed Plan, so the UI (PositionCard,
 * Activity feed) renders the enforced allocation without a separate read-back.
 * cycleId is the CurationController nonce AFTER execution (plan.nonce + 1), which
 * is a monotonic per-run counter.
 */
export function cycleFromPlan(plan: DecodedPlan): OnChainCycle {
  return {
    planId: plan.planId,
    totalOut: plan.totalOut,
    reserveAmount: plan.reserveAmount,
    amounts: planAmountsVector(plan),
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    cycleId: plan.nonce + 1n,
  };
}

/**
 * Full loop: read CurationController.nonce() -> sendCuration({market,nonce})
 * {value:fee} -> derive instructionId -> poll ext-proxy -> decode the signed
 * (Plan, signature) -> CurationController.executePlan(plan, signature) to enforce
 * it on-chain -> wait for the receipt.
 *
 * The signer is the throwaway DEMO_SIGNER_KEY when set (no wallet popup), else
 * the injected wallet on Coston2. `snapshot` is the research-schema market object
 * (or null to use the enclave's bundled snapshot). The executePlan write is the
 * real execution target; a revert there fails the run (it is no longer a
 * best-effort display write). The returned `display` reflects the executed plan
 * amounts and the executePlan tx.
 */
export async function runInRealTee(
  snapshot: unknown | null,
  opts: RunTeeOptions = {},
): Promise<RunTeeResult> {
  if (!teeConfigured()) {
    throw new Error(
      "TEE endpoint not configured. Fill INSTRUCTION_SENDER and EXT_PROXY_URL in src/tee.config.ts after deploying the TEE stack.",
    );
  }
  const step = opts.onStep ?? (() => {});

  const { wallet, account, signer } = await resolveSigner();
  const pub = makeCoston2Client();

  // Read the controller nonce so the enclave binds the signed Plan to it and
  // executePlan accepts the plan exactly once.
  const nonce = (await pub.readContract({
    address: CURATION_CONTROLLER,
    abi: CURATION_CONTROLLER_ABI,
    functionName: "nonce",
  })) as bigint;

  const message = encodeCurationMessage(snapshot, nonce);
  const fee = opts.feeOverride ?? INSTRUCTION_FEE;

  step("submitting-instruction");
  const txHash = await wallet.writeContract({
    account: signer,
    chain: coston2Chain,
    address: INSTRUCTION_SENDER as Hex,
    abi: INSTRUCTION_SENDER_ABI,
    functionName: "sendCuration",
    args: [message],
    value: fee,
  });

  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`sendCuration reverted (tx ${txHash}).`);
  }

  step("waiting-for-enclave");
  const instructionId = await instructionIdFromLogs(receipt.logs);
  const result = await pollResult(instructionId);

  // Enforce the enclave-signed Plan on-chain via CurationController.executePlan.
  // This is the real execution target: a revert here fails the run.
  step("writing-on-chain");
  const execTxHash = await wallet.writeContract({
    account: signer,
    chain: coston2Chain,
    address: CURATION_CONTROLLER,
    abi: CURATION_CONTROLLER_ABI,
    functionName: "executePlan",
    args: [result.plan as never, result.signature],
  });
  const execReceipt = await pub.waitForTransactionReceipt({ hash: execTxHash });
  if (execReceipt.status !== "success") {
    throw new Error(`executePlan reverted (tx ${execTxHash}).`);
  }

  const display: OnChainDisplay = {
    cycle: cycleFromPlan(result.plan),
    cycleCount: result.plan.nonce + 1n,
    pushTxHash: execTxHash,
    contract: CURATION_CONTROLLER,
  };

  step("done");
  return { ...result, txHash: execTxHash, account, display, mode: "tee" };
}

// --------------------------------------------------------------------------
// Local fallback: compute client-side, write the plan on-chain
// --------------------------------------------------------------------------

const ZERO_INSTRUCTION_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

/**
 * Fast pre-flight: is the ext-proxy actually serving the extension API?
 *
 * A live ext-proxy answers the result endpoint with JSON; a dead cloudflared
 * tunnel answers a text/HTML error page (we saw text/plain 404). We only commit
 * to the on-chain instruction tx + polling when this passes, so a stale tunnel
 * never hangs the button, it just falls back to the local path.
 */
export async function proxyHealthy(timeoutMs = 4000): Promise<boolean> {
  if (!teeConfigured()) return false;
  const url = `${EXT_PROXY_URL.replace(/\/+$/, "")}/action/result/${ZERO_INSTRUCTION_ID}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    clearTimeout(t);
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("application/json")) return true;
    // The live Flare ext-proxy answers an unknown instruction id with its own
    // plain-text "response not in storage: not found" (or Go's "404 page not
    // found"). A dead cloudflared tunnel answers a Cloudflare error page. Match
    // the proxy's signatures and reject the Cloudflare error.
    const body = (await res.text()).toLowerCase();
    if (body.includes("cloudflare") || body.includes("error code") || body.includes("<!doctype")) {
      return false;
    }
    return body.includes("not in storage") || body.includes("404 page not found") || body.includes("not found");
  } catch {
    return false;
  }
}

/**
 * REAL TEE path via the enclave gateway. POSTs {market, nonce} to the gateway,
 * which forwards to the live Flare enclave; the enclave computes AND signs the
 * plan inside the TEE and returns abi.encode(Plan, signature). We then enforce it
 * on-chain via CurationController.executePlan. No on-chain FCC message bus, no
 * client-side signing: the enclave is the signer.
 */
export async function runViaGateway(
  snapshot: unknown | null,
  opts: RunTeeOptions = {},
): Promise<RunTeeResult> {
  if (!gatewayConfigured()) {
    throw new Error("Enclave gateway not configured (GATEWAY_URL in src/tee.config.ts).");
  }
  const step = opts.onStep ?? (() => {});
  const { wallet, account, signer } = await resolveSigner();
  const pub = makeCoston2Client();

  step("submitting-instruction");
  const nonce = (await pub.readContract({
    address: CURATION_CONTROLLER,
    abi: CURATION_CONTROLLER_ABI,
    functionName: "nonce",
  })) as bigint;

  step("waiting-for-enclave");
  const res = await fetch(`${GATEWAY_URL.replace(/\/+$/, "")}/curation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ market: snapshot ?? undefined, nonce: nonce.toString() }),
  });
  if (!res.ok) throw new Error(`enclave gateway HTTP ${res.status}`);
  const body = (await res.json()) as { status: number; data: Hex; log?: string };
  if (body.status !== 1 || !body.data || body.data === "0x") {
    throw new Error(`enclave returned no signed plan: ${body.log ?? "unknown"}`);
  }
  const { plan, signature } = decodePlanSig(body.data);

  step("writing-on-chain");
  const execTxHash = await wallet.writeContract({
    account: signer,
    chain: coston2Chain,
    address: CURATION_CONTROLLER,
    abi: CURATION_CONTROLLER_ABI,
    functionName: "executePlan",
    args: [plan as never, signature],
  });
  const execReceipt = await pub.waitForTransactionReceipt({ hash: execTxHash });
  if (execReceipt.status !== "success") {
    throw new Error(`executePlan reverted (tx ${execTxHash}).`);
  }
  step("done");

  const raw: ActionResultJson = {
    id: plan.planId,
    submissionTag: "gateway",
    status: 1,
    log: "Computed + signed by the live Flare enclave; enforced on-chain.",
    opType: CURATION_OPTYPE,
    opCommand: CURATION_OPCOMMAND,
    additionalResultStatus: "0x",
    version: "gateway",
    data: body.data,
  };
  return {
    instructionId: plan.planId,
    plan,
    signature,
    raw,
    resultUrl: "",
    txHash: execTxHash,
    account,
    display: {
      cycle: cycleFromPlan(plan),
      cycleCount: plan.nonce + 1n,
      pushTxHash: execTxHash,
      contract: CURATION_CONTROLLER,
    },
    mode: "tee",
  };
}

// planHash preimage, byte-for-byte with demo/schema/preimage.md and the enclave
// (tee-extension/extension/avv.ts). Domain-separated on the controller + chainId.
function computePlanHash(plan: DecodedPlan): Hex {
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
      [plan.allocations as readonly { venueId: bigint; amount: bigint }[]],
    ),
  );
  return keccak256(
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
        CURATION_CONTROLLER,
        BigInt(COSTON2.chainId),
        plan.planId,
        plan.modelVersion,
        plan.codeHash,
        plan.nonce,
        plan.expiry,
        plan.totalOut,
        plan.reserveAmount,
        allocHash,
      ],
    ),
  );
}

/**
 * Simulated-enclave path for the button when no live TEE endpoint is configured
 * (or it is unreachable). The Plan is computed client-side with the SAME
 * optimizer the enclave runs (see live.ts), then signed with the
 * SIMULATED_TEE_SIGNER_KEY that stands in for the enclave (its address is the
 * registered MandateRegistry.teeAddress), and enforced on-chain via
 * CurationController.executePlan exactly like the live-TEE path. The on-chain
 * verification, mandate enforcement, and fund movement are REAL. Only the
 * signer is a browser stand-in for the enclave. This mirrors the sibling demo,
 * which also signs with a throwaway key "standing in for the enclave".
 */
export async function runLocalCycle(
  plan: DecodedPlan,
  opts: RunTeeOptions = {},
): Promise<RunTeeResult> {
  const step = opts.onStep ?? (() => {});
  const { wallet, account, signer } = await resolveSigner();
  const pub = makeCoston2Client();

  // Bind the plan to the live controller nonce (executePlan accepts it once) and
  // give it a fresh unique planId (replay-guarded on-chain).
  step("waiting-for-enclave");
  const nonce = (await pub.readContract({
    address: CURATION_CONTROLLER,
    abi: CURATION_CONTROLLER_ABI,
    functionName: "nonce",
  })) as bigint;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const bound: DecodedPlan = {
    ...plan,
    nonce,
    expiry: now + 3600n,
    planId: keccak256(encodePacked(["uint256", "uint256"], [nonce, now])),
  };

  // Sign the plan preimage with the stand-in enclave key.
  const enclave = privateKeyToAccount(SIMULATED_TEE_SIGNER_KEY);
  const signature = await enclave.signMessage({
    message: { raw: computePlanHash(bound) },
  });

  step("writing-on-chain");
  const execTxHash = await wallet.writeContract({
    account: signer,
    chain: coston2Chain,
    address: CURATION_CONTROLLER,
    abi: CURATION_CONTROLLER_ABI,
    functionName: "executePlan",
    args: [bound as never, signature],
  });
  const execReceipt = await pub.waitForTransactionReceipt({ hash: execTxHash });
  if (execReceipt.status !== "success") {
    throw new Error(`executePlan reverted (tx ${execTxHash}).`);
  }
  step("done");

  const raw: ActionResultJson = {
    id: bound.planId,
    submissionTag: "simulated-enclave",
    status: 1,
    log: "Signed by the simulated enclave key and enforced on-chain via CurationController.",
    opType: CURATION_OPTYPE,
    opCommand: CURATION_OPCOMMAND,
    additionalResultStatus: "0x",
    version: "simulated",
    data: "0x",
  };

  return {
    instructionId: bound.planId,
    plan: bound,
    signature,
    raw,
    resultUrl: "",
    txHash: execTxHash,
    account,
    display: {
      cycle: cycleFromPlan(bound),
      cycleCount: bound.nonce + 1n,
      pushTxHash: execTxHash,
      contract: CURATION_CONTROLLER,
    },
    mode: "local",
  };
}

/** Convenience re-export so UI can build the same "0x"/hex message for display. */
export { toHex };
