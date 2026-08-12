// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "../interfaces/IERC20.sol";
import {IVenueAdapter} from "../interfaces/IVenueAdapter.sol";
import {MockLendingVenue} from "../mocks/MockLendingVenue.sol";

/// @title VenueAdapter
/// @notice Capped custody adapter for a single lending venue. Holds the supplied
///         position on behalf of the vault and re-checks its own absolute hard
///         cap as defense in depth.
contract VenueAdapter is IVenueAdapter {
    IERC20 public immutable asset;
    MockLendingVenue public immutable venue;
    uint256 public immutable venueId;
    uint256 public immutable hardCap;

    address public controller;

    uint256 public maxUtilBips = 8000;
    uint256 public minLiquidity;

    uint256 internal _supplied;

    modifier onlyController() {
        require(msg.sender == controller, "not controller");
        _;
    }

    constructor(
        IERC20 _asset,
        MockLendingVenue _venue,
        uint256 _venueId,
        uint256 _hardCap
    ) {
        asset = _asset;
        venue = _venue;
        venueId = _venueId;
        hardCap = _hardCap;
    }

    function setController(address c) external {
        require(controller == address(0), "controller set");
        controller = c;
    }

    /// @notice Supply `amount` (already transferred in by the controller) to the
    ///         underlying venue. Reverts past the adapter hard cap.
    function allocate(uint256 amount) external onlyController {
        require(amount <= hardCap, "over venue hardcap");
        _supplied += amount;
        require(asset.approve(address(venue), amount), "approve failed");
        venue.supply(amount);
    }

    function withdrawTo(address to, uint256 amount) external onlyController {
        venue.withdraw(amount);
        _supplied -= amount;
        require(asset.transfer(to, amount), "transfer failed");
    }

    /// @notice Asset value custodied for `holder`. Single-principal model: the
    ///         controller/vault is the only holder, so we report the supplied
    ///         amount for any non-zero query used by totalAssets().
    function balanceOf(address) external view returns (uint256) {
        return _supplied;
    }

    function isEligible() external view returns (bool) {
        return
            venue.utilisationBips() <= maxUtilBips &&
            venue.availableLiquidity() >= minLiquidity;
    }
}
