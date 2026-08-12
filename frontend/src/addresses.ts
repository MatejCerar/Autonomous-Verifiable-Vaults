// Generated bridge to the frozen root addresses.json.
// The build imports ../../addresses.json (chainId 114 coston2).
// This file re-exports it with a typed shape and a "deployed" guard so the UI
// degrades gracefully while contracts are not yet deployed.
import rawAddresses from "../../addresses.json";

export interface DeployedAddresses {
  mockStable: string;
  vault: string;
  mandateRegistry: string;
  curationController: string;
  reserveAdapter: string;
  venueAdapters: string[];
  mockVenues: string[];
}

export interface Addresses {
  chainId: number;
  network: string;
  rpcUrl: string;
  contractRegistry: string;
  flrUsdFeedId: string;
  teeSignerAddress: string;
  modelVersion: string;
  codeHash: string;
  deployed: DeployedAddresses;
}

export const addresses = rawAddresses as Addresses;

/**
 * True only when the core contracts have real (non-empty) addresses.
 * Used to show the "deploy the contracts first" banner and to disable the
 * on-chain steps (4-6) while still allowing the model-service steps (1-3).
 */
export function isDeployed(a: Addresses = addresses): boolean {
  const d = a.deployed;
  return Boolean(
    d &&
      d.curationController &&
      d.vault &&
      d.mandateRegistry &&
      d.venueAdapters &&
      d.venueAdapters.length > 0 &&
      d.venueAdapters.every((x) => Boolean(x)),
  );
}
