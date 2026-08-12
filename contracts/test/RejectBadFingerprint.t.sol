// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BaseTest} from "./Base.t.sol";
import {PlanLib} from "../src/libraries/PlanLib.sol";

contract RejectBadFingerprintTest is BaseTest {
    function testRejectBadFingerprint() public {
        PlanLib.Allocation[] memory allocs = new PlanLib.Allocation[](2);
        allocs[0] = PlanLib.Allocation({venueId: 0, amount: 250_000 ether});
        allocs[1] = PlanLib.Allocation({venueId: 1, amount: 250_000 ether});

        // unregistered codeHash for the (otherwise valid) version
        PlanLib.Plan memory plan = PlanLib.Plan({
            planId: keccak256("plan-badfp"),
            modelVersion: MODEL_VERSION,
            codeHash: keccak256("unregistered-model"),
            nonce: 0,
            expiry: block.timestamp + 3600,
            totalOut: 700_000 ether,
            reserveAmount: 200_000 ether,
            allocations: allocs
        });

        bytes memory sig = _sign(TEE_PK, plan);

        vm.expectRevert(bytes("bad fingerprint"));
        controller.executePlan(plan, sig);

        assertEq(adapter0.balanceOf(address(vault)), 0);
        assertEq(reserve.balanceOf(address(vault)), 0);
    }
}
