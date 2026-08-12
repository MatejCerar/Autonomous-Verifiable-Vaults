// Minimal ABIs inlined for the demo. The root abi/*.json dir is currently empty;
// these mirror the frozen contract surfaces (CurationController.executePlan + nonce,
// AutomatedCurationVault.totalAssets/convertToAssets, VenueAdapter.balanceOf + hardCap,
// MandateRegistry caps, ReserveAdapter.balanceOf). Read defensively.

// Plan tuple matches PlanLib.Plan / preimage.md exactly.
export const planComponents = [
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
] as const;

export const curationControllerAbi = [
  {
    type: "function",
    name: "executePlan",
    stateMutability: "nonpayable",
    inputs: [
      { name: "plan", type: "tuple", components: planComponents },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "nonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "adapterCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "adapters",
    stateMutability: "view",
    inputs: [{ name: "venueId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const vaultAbi = [
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const venueAdapterAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "hardCap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "venueId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const reserveAdapterAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const mandateRegistryAbi = [
  {
    type: "function",
    name: "venueCapBips",
    stateMutability: "view",
    inputs: [{ name: "venueId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxTotalOutBips",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "minReserveBips",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "teeAddress",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;
