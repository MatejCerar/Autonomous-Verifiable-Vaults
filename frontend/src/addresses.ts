// Mystic Finance (Morpho Vault V2) addresses on Flare mainnet (chainId 14).
// This demo is NOT broadcast on-chain: Mystic is Flare-mainnet only and we do
// not sign or send. These addresses are used only to label the prepared
// (unsigned) transactions and to link the block explorer.
//
// Sourced from research/market-data.json (live on-chain reads).
// No emojis, no em dashes in this file (house style).

export interface VenueAddresses {
  symbol: string;
  tokenSymbol: string;
  venueId: number;
  token: string;
  vault: string;
  vaultName: string;
  decimals: number;
}

export interface Addresses {
  chainId: number;
  network: string;
  explorer: string;
  app: string;
  protocol: string;
  contractRegistry: string;
  ftsoV2: string;
  morphoBlue: string;
  adaptiveCurveIrm: string;
  // CurationController used for planHash domain separation. Empty in the
  // mainnet-prepare default (not deployed); a deploy overwrites addresses.json.
  // The offline sample envelopes are signed against this value, so the browser
  // reproduces the exact planHash for the signer recovery.
  curationController: string;
  venues: VenueAddresses[];
}

export const addresses: Addresses = {
  chainId: 14,
  network: "Flare mainnet",
  explorer: "https://flare-explorer.flare.network",
  app: "https://app.mysticfinance.xyz",
  protocol: "Mystic Finance (Morpho Vault V2 over Morpho Blue)",
  contractRegistry: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
  ftsoV2: "0x7BDE3Df0624114eDB3A67dFe6753e62f4e7c1d20",
  morphoBlue: "0xF4346F5132e810f80a28487a79c7559d9797E8B0",
  adaptiveCurveIrm: "0xE5B5627C5973AfAE1928a6b8e5c1D6AABFEC8a7a",
  curationController: "",
  venues: [
    {
      symbol: "FXRP",
      tokenSymbol: "FXRP",
      venueId: 0,
      token: "0xAd552A648C74D49E10027AB8a618A3ad4901c5bE",
      vault: "0x53184aDaBF312b490BF1EbcFdC896FEfF6019a14",
      vaultName: "Core FXRP",
      decimals: 6,
    },
    {
      symbol: "USDT0",
      tokenSymbol: "USDT0",
      venueId: 1,
      token: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D",
      vault: "0xE8dd6A1e13244A27bDaa19CcBf33013647C675d1",
      vaultName: "Core USDT0",
      decimals: 6,
    },
    {
      symbol: "WFLR",
      tokenSymbol: "WFLR",
      venueId: 2,
      token: "0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d",
      vault: "0x1aEadA3C251215f1294720B80FcB3D1D005F3585",
      vaultName: "Core wFLR",
      decimals: 18,
    },
  ],
};

export function venueBySymbol(symbol: string): VenueAddresses | undefined {
  return addresses.venues.find((v) => v.symbol === symbol);
}

export function explorerAddressUrl(addr: string): string {
  return `${addresses.explorer}/address/${addr}`;
}
