// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BaseTest} from "./Base.t.sol";
import {PlanLib} from "../src/libraries/PlanLib.sol";
import {CurationController} from "../src/CurationController.sol";
import {CurationControllerV2} from "./CurationControllerV2.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @notice UUPS upgrade coverage for the CurationController proxy. Confirms an
///         owner-authorized upgrade swaps the implementation while preserving
///         proxy storage, and that a non-owner cannot upgrade.
contract UpgradeTest is BaseTest {
    function _bumpNonce() internal {
        // Execute one valid plan so the proxy holds pre-upgrade state (nonce=1).
        PlanLib.Allocation[] memory allocs = new PlanLib.Allocation[](2);
        allocs[0] = PlanLib.Allocation({venueId: 0, amount: 250_000 ether});
        allocs[1] = PlanLib.Allocation({venueId: 1, amount: 250_000 ether});

        PlanLib.Plan memory plan = PlanLib.Plan({
            planId: keccak256("upgrade-plan-1"),
            modelVersion: MODEL_VERSION,
            codeHash: CODE_HASH,
            nonce: 0,
            expiry: block.timestamp + 3600,
            totalOut: 700_000 ether,
            reserveAmount: 200_000 ether,
            allocations: allocs
        });

        bytes memory sig = _sign(TEE_PK, plan);
        controller.executePlan(plan, sig);
    }

    function testUpgradePreservesStateAndReportsV2() public {
        // Pre-upgrade state on the proxy.
        _bumpNonce();
        assertEq(controller.nonce(), 1);

        CurationControllerV2 implV2 = new CurationControllerV2();

        // Owner (the test contract, which deployed the proxy in setUp) upgrades.
        UUPSUpgradeable(address(controller)).upgradeToAndCall(
            address(implV2),
            ""
        );

        // Proxy now runs V2 logic ...
        assertEq(CurationControllerV2(address(controller)).version(), 2);

        // ... and the pre-upgrade state value is preserved through the upgrade.
        assertEq(controller.nonce(), 1);
    }

    function testNonOwnerCannotUpgrade() public {
        CurationControllerV2 implV2 = new CurationControllerV2();

        vm.prank(address(0xBAD));
        vm.expectRevert();
        UUPSUpgradeable(address(controller)).upgradeToAndCall(
            address(implV2),
            ""
        );
    }
}
