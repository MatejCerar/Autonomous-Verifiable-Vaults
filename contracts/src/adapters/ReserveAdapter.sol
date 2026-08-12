// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "../interfaces/IERC20.sol";
import {IReserveAdapter} from "../interfaces/IReserveAdapter.sol";

/// @title ReserveAdapter
/// @notice Trivial custodian: the fail-closed sink. Holds asset idle.
contract ReserveAdapter is IReserveAdapter {
    IERC20 public immutable asset;
    address public controller;

    uint256 internal _parked;

    modifier onlyController() {
        require(msg.sender == controller, "not controller");
        _;
    }

    constructor(IERC20 _asset) {
        asset = _asset;
    }

    function setController(address c) external {
        require(controller == address(0), "controller set");
        controller = c;
    }

    /// @notice Accept `amount` (already transferred in by the controller) into
    ///         the reserve.
    function park(uint256 amount) external onlyController {
        _parked += amount;
    }

    function withdrawTo(address to, uint256 amount) external onlyController {
        _parked -= amount;
        require(asset.transfer(to, amount), "transfer failed");
    }

    function balanceOf(address) external view returns (uint256) {
        return _parked;
    }
}
