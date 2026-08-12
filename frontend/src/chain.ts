import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  curationControllerAbi,
  mandateRegistryAbi,
  reserveAdapterAbi,
  vaultAbi,
  venueAdapterAbi,
} from "@/abi";
import { addresses, isDeployed } from "@/addresses";

export const RPC_URL = import.meta.env.VITE_RPC_URL ?? addresses.rpcUrl;
export const MODEL_URL =
  import.meta.env.VITE_MODEL_URL ?? "http://127.0.0.1:8080";
const DEV_KEY = (import.meta.env.VITE_DEV_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`;

// coston2, chainId 114.
export const chain = defineChain({
  id: addresses.chainId || 114,
  name: addresses.network || "coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

export const publicClient: PublicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

export const devAccount = privateKeyToAccount(DEV_KEY);

export const walletClient: WalletClient = createWalletClient({
  account: devAccount,
  chain,
  transport: http(RPC_URL),
});

export { addresses, isDeployed };

export const abis = {
  curationController: curationControllerAbi,
  vault: vaultAbi,
  venueAdapter: venueAdapterAbi,
  reserveAdapter: reserveAdapterAbi,
  mandateRegistry: mandateRegistryAbi,
};

export function asAddress(s: string): Address {
  return s as Address;
}

/** Parse a viem/anvil error blob down to one of the frozen revert strings. */
const KNOWN_REVERTS = [
  "replay",
  "bad nonce",
  "expired",
  "bad fingerprint",
  "bad signer",
  "over venue cap",
  "over total cap",
  "reserve floor",
  "totals mismatch",
] as const;

export type RevertReason = (typeof KNOWN_REVERTS)[number];

export function parseRevertReason(err: unknown): RevertReason | undefined {
  const blob = extractErrorText(err).toLowerCase();
  return KNOWN_REVERTS.find((r) => blob.includes(r));
}

function extractErrorText(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  const parts: string[] = [];
  const anyErr = err as {
    message?: string;
    shortMessage?: string;
    details?: string;
    reason?: string;
    cause?: unknown;
    metaMessages?: string[];
  };
  if (anyErr.shortMessage) parts.push(anyErr.shortMessage);
  if (anyErr.reason) parts.push(anyErr.reason);
  if (anyErr.details) parts.push(anyErr.details);
  if (anyErr.message) parts.push(anyErr.message);
  if (Array.isArray(anyErr.metaMessages)) parts.push(...anyErr.metaMessages);
  if (anyErr.cause) parts.push(extractErrorText(anyErr.cause));
  return parts.join(" | ");
}
