// Minimal ABIs for the Mystic allocation demo. The prepared transactions call
// ERC-20 approve on each token then ERC-4626 deposit on each Mystic Core vault
// (Morpho Vault V2). These ABIs are used only to label / decode the prepared
// calldata for display. Nothing here is broadcast.
//
// No emojis, no em dashes in this file (house style).

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

// ERC-4626 tokenized vault surface. Mystic Core vaults are Morpho Vault V2
// (adapter-based) but expose the standard 4626 deposit(assets, receiver).
export const erc4626Abi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "convertToShares",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ContractRegistry: resolves live Flare system-contract addresses by name. Only
// used to look up FtsoV2 (never hardcode). Same address on all four networks.
export const contractRegistryAbi = [
  {
    type: "function",
    name: "getContractAddressByName",
    stateMutability: "view",
    inputs: [{ name: "_name", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// FtsoV2 block-latency feed reader. getFeedById returns the scaled integer value
// plus an int8 decimals exponent and the feed timestamp. Marked view here (a fee
// may apply for the payable variant, but eth_call reads are free).
export const ftsoV2Abi = [
  {
    type: "function",
    name: "getFeedById",
    stateMutability: "view",
    inputs: [{ name: "_feedId", type: "bytes21" }],
    outputs: [
      { name: "value", type: "uint256" },
      { name: "decimals", type: "int8" },
      { name: "timestamp", type: "uint64" },
    ],
  },
] as const;

export const abis = {
  erc20: erc20Abi,
  erc4626: erc4626Abi,
  contractRegistry: contractRegistryAbi,
  ftsoV2: ftsoV2Abi,
};
