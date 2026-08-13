// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "../interfaces/IERC20.sol";
import {IERC4626} from "../interfaces/IERC4626.sol";
import {IVenueAdapter} from "../interfaces/IVenueAdapter.sol";

/// @title MysticVenueAdapter
/// @notice Production venue adapter that routes the vault's capital into a live
///         Mystic Core ERC-4626 vault on Flare mainnet (Mystic's Morpho-style
///         curated market wrapper). It is a drop-in for VenueAdapter: the exact
///         same IVenueAdapter surface the CurationController expects, so the
///         enforcement layer is untouched. The only difference is where the
///         funds go: instead of a MockLendingVenue it deposits into a real
///         ERC-4626 market and holds the resulting shares.
///
/// @dev Funds flow, matching VenueAdapter exactly:
///        - The controller transfers `amount` of the underlying INTO this
///          adapter, then calls allocate(amount). So allocate assumes the
///          asset is already on this contract's balance.
///        - The controller reads balanceOf(vault) to size the reclaim, then
///          calls withdrawTo(vault, amount) to pull it back.
///      Because ERC-4626 conversions can round, balanceOf reports the live
///      convertToAssets(shares) value, and withdrawTo redeems ALL held shares
///      and transfers exactly what the market returned (the controller passes
///      the full balanceOf value as `amount`, so this reclaims the position in
///      full each cycle, matching the idempotent-rebalance model).
contract MysticVenueAdapter is IVenueAdapter {
    IERC20 public immutable asset;
    IERC4626 public immutable mysticVault;
    uint256 public immutable venueId;
    uint256 public immutable hardCap;

    address public controller;

    // Shares held in the Mystic vault on behalf of the AutomatedCurationVault.
    uint256 public shares;

    modifier onlyController() {
        require(msg.sender == controller, "not controller");
        _;
    }

    /// @param _asset       The venue underlying token (e.g. FXRP, USDT0, WFLR).
    /// @param _mysticVault The live Mystic Core ERC-4626 vault for that asset.
    /// @param _venueId     The venue id this adapter serves.
    /// @param _hardCap     Absolute defense-in-depth cap (in underlying units).
    constructor(
        IERC20 _asset,
        IERC4626 _mysticVault,
        uint256 _venueId,
        uint256 _hardCap
    ) {
        require(
            _mysticVault.asset() == address(_asset),
            "vault asset mismatch"
        );
        asset = _asset;
        mysticVault = _mysticVault;
        venueId = _venueId;
        hardCap = _hardCap;
    }

    function setController(address c) external {
        require(controller == address(0), "controller set");
        controller = c;
    }

    /// @notice Deposit `amount` (already transferred in by the controller) into
    ///         the live Mystic vault. Reverts past the adapter hard cap.
    function allocate(uint256 amount) external onlyController {
        require(amount <= hardCap, "over venue hardcap");
        require(
            asset.approve(address(mysticVault), amount),
            "approve failed"
        );
        uint256 minted = mysticVault.deposit(amount, address(this));
        shares += minted;
    }

    /// @notice Reclaim the position to `to`. Redeems ALL held shares from the
    ///         Mystic vault and forwards exactly what the market returned. The
    ///         controller sizes `amount` from balanceOf(vault) each cycle, so
    ///         this fully unwinds the venue on every rebalance.
    function withdrawTo(address to, uint256 amount) external onlyController {
        uint256 held = shares;
        if (held == 0) {
            return;
        }
        shares = 0;
        uint256 got = mysticVault.redeem(held, address(this), address(this));
        // `amount` is the controller's intended reclaim (== balanceOf(vault));
        // silence the unused warning while keeping the surface identical.
        amount;
        require(asset.transfer(to, got), "transfer failed");
    }

    /// @notice Asset value custodied for the single principal (vault). Reports
    ///         the live underlying value of the held Mystic shares.
    function balanceOf(address) external view returns (uint256) {
        uint256 held = shares;
        if (held == 0) {
            return 0;
        }
        return mysticVault.convertToAssets(held);
    }

    /// @notice Underlying assets this adapter has deposited into the Mystic
    ///         vault, at current share price. Mirror for dashboards/tests.
    function totalAssets() external view returns (uint256) {
        uint256 held = shares;
        if (held == 0) {
            return 0;
        }
        return mysticVault.convertToAssets(held);
    }

    /// @notice A live Mystic Core vault is always eligible from the adapter's
    ///         perspective; market-level risk is enforced by the mandate caps
    ///         in the CurationController, not here.
    function isEligible() external pure returns (bool) {
        return true;
    }
}
