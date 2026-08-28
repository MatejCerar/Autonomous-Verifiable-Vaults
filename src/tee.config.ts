// TEE integration configuration for the "Run this cycle in the real Flare TEE"
// path. These values are filled in by the deploy engineer AFTER the fcc-extension
// TEE stack is deployed on Coston2 (see demo-with-tee/README.md, section (b)+(d)).
//
// INSTRUCTION_SENDER + EXT_PROXY_URL ship EMPTY on purpose (the live TEE stack
// is ephemeral, an engineer redeploys it per tee-extension/DEPLOY.md). When they
// are empty, OR the proxy is unreachable, the "Run rebalance cycle" button still
// works: it computes the plan client-side with the same optimizer and writes it
// on-chain to ALLOCATION_DISPLAY via DEMO_SIGNER_KEY. Fill both to route the
// cycle through a live Flare enclave instead. ALLOCATION_DISPLAY + DEMO_SIGNER_KEY
// are the only fields the button needs to record a real on-chain cycle.

/**
 * Deployed InstructionSender contract on Coston2. This is the on-chain entry
 * point the frontend calls sendCuration(bytes) on. Leave empty until deployed.
 *
 * Example (ephemeral, from an earlier bring-up, DO NOT reuse):
 *   0x723e8a56Fade6709568b692EE84852164B6BB8ED
 */
export const INSTRUCTION_SENDER = "" as `0x${string}` | "";

/**
 * Deployed AllocationDisplay "display vault" on Coston2 (see onchain/). After
 * the enclave Plan is decoded, the frontend writes it here via pushCycle and
 * reads latest()/cycleCount() back from chain to render the "On-chain best
 * position" panel. Leave empty until deployed; when empty the on-chain write +
 * read step is skipped and only the enclave-signed Plan is shown.
 *
 * Deploy with onchain/script/DeployAllocationDisplay.s.sol, then paste the
 * printed address here.
 */
export const ALLOCATION_DISPLAY = "0xf56C3616daaAF2172A118Ac8acE7b0d7CdCE1fCb" as `0x${string}` | "";

/**
 * Deployed CurationController enforcement backend on Coston2 (chainId 114). This
 * is the real execution target now: after the enclave computes AND signs the
 * Plan, the frontend calls executePlan(plan, signature) here (replacing the old
 * display-only AllocationDisplay.pushCycle write). Its nonce() is read before
 * each run to build the instruction message the enclave signs against.
 */
export const CURATION_CONTROLLER =
  "0x47A4E99f26F3ABF95Ca09f81399ECf84b04F3909" as `0x${string}`;

/**
 * Minimal CurationController ABI: nonce() for replay-protection and
 * executePlan((Plan) plan, bytes signature) to enforce the enclave-signed plan.
 * The Plan tuple layout matches PLAN_ABI in src/tee.ts.
 */
export const CURATION_CONTROLLER_ABI = [
  {
    type: "function",
    name: "nonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "executePlan",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "plan",
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
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/**
 * OPTIONAL throwaway relayer key (0x-prefixed 32-byte hex). When set, the
 * frontend uses this local viem account to submit BOTH txs (sendCuration and
 * pushCycle), so the client just presses the button with no wallet popup. This
 * MUST be the same key used to deploy AllocationDisplay (its updater), or
 * pushCycle reverts NotUpdater. When empty, the flow falls back to the injected
 * wallet (MetaMask) for sendCuration and skips the on-chain write when no signer
 * is available for it.
 *
 * SECURITY: demo-only, funded with a few C2FLR from the Coston2 faucet. Never
 * put a real key here. It ships EMPTY.
 */
export const DEMO_SIGNER_KEY = "0x508923b11aa8ec554a05e8a95f0ceaf81bd493e2ce42416ad464824c879051b4" as `0x${string}` | "";

/**
 * Public URL of the ext-proxy the TEE node polls / serves action results on.
 * The frontend polls `${EXT_PROXY_URL}/action/result/${instructionId}`.
 * Typically a cloudflared tunnel URL, e.g. https://<slug>.trycloudflare.com
 * Leave empty until the tunnel/endpoint is up. No trailing slash.
 */
export const EXT_PROXY_URL = "";

/**
 * Enclave gateway URL. This is the REAL TEE path the button uses: a thin CORS
 * shim in front of the live Flare enclave (see fce-scaffold/enclave-gateway.mjs).
 * The frontend POSTs {market, nonce} here; the enclave computes AND EIP-191-signs
 * the plan INSIDE the TEE and returns abi.encode(Plan, signature). The frontend
 * then calls CurationController.executePlan with it. This is the enclave doing
 * the real work; it only skips the flaky on-chain FCC message bus. Ephemeral
 * (a cloudflared tunnel to the enclave): repoint after each enclave redeploy.
 */
export const GATEWAY_URL =
  "https://task-healthcare-specialties-arising.trycloudflare.com";

/** True when the enclave gateway (real TEE path) is configured. */
export function gatewayConfigured(): boolean {
  return typeof GATEWAY_URL === "string" && GATEWAY_URL.startsWith("http");
}

/**
 * Simulated enclave signer key. When no live TEE endpoint is configured (or it
 * is unreachable), the frontend signs the plan preimage with THIS key to stand
 * in for the enclave, exactly like the sibling demo signs with a throwaway key
 * "standing in for the enclave". Its address is the registered
 * MandateRegistry.teeAddress (0xd50950812E6A6843633e8e4d51ADDFB4Ccc59584), so
 * the client-signed plan passes CurationController.executePlan on-chain. The
 * on-chain verification, mandate enforcement, and fund movement are all REAL;
 * only WHO produced the signature (a browser stand-in vs a live enclave) differs.
 *
 * SECURITY: demo-only testnet key. When you run the real enclave stack, fill
 * INSTRUCTION_SENDER + EXT_PROXY_URL and the enclave signs instead of this key.
 */
export const SIMULATED_TEE_SIGNER_KEY =
  "0x6fccfd706182c24a8c22f959077d79fd937673a2625dc77c880422f50c77c38a" as `0x${string}`;

/**
 * bytes32 of the op-type / op-command the InstructionSender.sendCuration uses.
 * These MUST match the bytes32("CURATION") / bytes32("CYCLE") constants in the
 * Solidity contract, or the enclave routes the action to "unsupported op type".
 *
 * bytes32 encoding: UTF-8 of the string, right-zero-padded to 32 bytes.
 *   "CURATION" = 0x4355524154494f4e (8 bytes) + 24 zero bytes
 *   "CYCLE"    = 0x4359434c45       (5 bytes) + 27 zero bytes
 */
export const CURATION_OPTYPE =
  "0x4355524154494f4e000000000000000000000000000000000000000000000000" as `0x${string}`;
export const CURATION_OPCOMMAND =
  "0x4359434c45000000000000000000000000000000000000000000000000000000" as `0x${string}`;

/**
 * Instruction fee forwarded as msg.value (in wei) when the required fee cannot
 * be read from chain. The registry may enforce a minimum (FeeTooLow revert);
 * the deploy engineer sets this to the current required fee. 1e6 wei matches the
 * scaffold's SendSayHello default. Kept small and configurable.
 */
export const INSTRUCTION_FEE = 1_000_000n;

/** Coston2 network constants. */
export const COSTON2 = {
  chainId: 114, // 0x72
  chainIdHex: "0x72",
  name: "Flare Testnet Coston2",
  rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
  explorer: "https://coston2-explorer.flare.network",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
} as const;

/** Poll budget for the ext-proxy action result (status 2 = pending). */
export const RESULT_POLL = {
  intervalMs: 2_000,
  timeoutMs: 30_000,
} as const;

/** True when both required config fields are present. */
export function teeConfigured(): boolean {
  return (
    typeof INSTRUCTION_SENDER === "string" &&
    INSTRUCTION_SENDER.length === 42 &&
    INSTRUCTION_SENDER.startsWith("0x") &&
    typeof EXT_PROXY_URL === "string" &&
    EXT_PROXY_URL.length > 0
  );
}

/** True when the AllocationDisplay vault address is filled in. */
export function displayConfigured(): boolean {
  return (
    typeof ALLOCATION_DISPLAY === "string" &&
    ALLOCATION_DISPLAY.length === 42 &&
    ALLOCATION_DISPLAY.startsWith("0x")
  );
}

/** True when a throwaway demo signer key is provided (no-wallet button mode). */
export function demoSignerConfigured(): boolean {
  return (
    typeof DEMO_SIGNER_KEY === "string" &&
    DEMO_SIGNER_KEY.length === 66 &&
    DEMO_SIGNER_KEY.startsWith("0x")
  );
}

/** Coston2 explorer link for a contract address. */
export function explorerAddress(addr: string): string {
  return `${COSTON2.explorer.replace(/\/+$/, "")}/address/${addr}`;
}

/** Coston2 explorer link for a tx hash. */
export function explorerTx(hash: string): string {
  return `${COSTON2.explorer.replace(/\/+$/, "")}/tx/${hash}`;
}
