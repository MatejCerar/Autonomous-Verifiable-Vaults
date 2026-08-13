// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title MysticAddresses
/// @notice Flare mainnet (chainId 14) constants for the Mystic Core markets used
///         by this demo. Each venue has an underlying token and a Mystic Core
///         ERC-4626 vault (a Morpho MetaMorpho vault) that the MysticVenueAdapter
///         deposits into. Addresses are verified against a live Flare fork by
///         test/MysticVenueFork.t.sol (asset() must match the token below).
///
///         Venue ids in this demo:
///           0 = FXRP, 1 = USDT0, 2 = WFLR.
library MysticAddresses {
    uint256 internal constant FLARE_CHAIN_ID = 14;

    // --- venue 0: FXRP ---
    address internal constant FXRP_TOKEN =
        0xAd552A648C74D49E10027AB8a618A3ad4901c5bE;
    address internal constant FXRP_VAULT =
        0x53184aDaBF312b490BF1EbcFdC896FEfF6019a14;

    // --- venue 1: USDT0 ---
    address internal constant USDT0_TOKEN =
        0xe7cd86e13AC4309349F30B3435a9d337750fC82D;
    address internal constant USDT0_VAULT =
        0xE8dd6A1e13244A27bDaa19CcBf33013647C675d1;

    // --- venue 2: WFLR ---
    address internal constant WFLR_TOKEN =
        0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d;
    address internal constant WFLR_VAULT =
        0x1aEadA3C251215f1294720B80FcB3D1D005F3585;
}
