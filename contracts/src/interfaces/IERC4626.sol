// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title IERC4626 (minimal)
/// @notice Minimal surface of the ERC-4626 tokenized vault standard used by the
///         MysticVenueAdapter to route into a live Mystic Core vault (a Morpho
///         MetaMorpho ERC-4626). Only the methods the adapter needs are declared.
interface IERC4626 {
    /// @return The address of the underlying token managed by the vault.
    function asset() external view returns (address);

    /// @return The total amount of the underlying asset held by the vault.
    function totalAssets() external view returns (uint256);

    /// @notice Deposit `assets` of underlying, minting shares to `receiver`.
    /// @return shares The amount of shares minted.
    function deposit(
        uint256 assets,
        address receiver
    ) external returns (uint256 shares);

    /// @notice Redeem `shares`, sending the underlying to `receiver`.
    /// @return assets The amount of underlying returned.
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external returns (uint256 assets);

    /// @notice Convert a share amount to its current underlying-asset value.
    function convertToAssets(
        uint256 shares
    ) external view returns (uint256 assets);

    /// @notice Convert an asset amount to the shares it would mint.
    function convertToShares(
        uint256 assets
    ) external view returns (uint256 shares);

    /// @return The share-token balance of `account`.
    function balanceOf(address account) external view returns (uint256);
}
