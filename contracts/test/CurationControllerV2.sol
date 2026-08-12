// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {CurationController} from "../src/CurationController.sol";

/// @title CurationControllerV2
/// @notice Minimal V2 implementation used only by the upgrade test. It extends
///         CurationController so the entire V1 storage layout is inherited
///         unchanged (append-only), and adds a trivial view. No new storage is
///         declared, so the layout stays compatible.
contract CurationControllerV2 is CurationController {
    function version() external pure returns (uint256) {
        return 2;
    }
}
