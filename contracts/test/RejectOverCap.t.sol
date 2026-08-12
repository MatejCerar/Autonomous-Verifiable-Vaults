// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BaseTest} from "./Base.t.sol";
import {PlanLib} from "../src/libraries/PlanLib.sol";

contract RejectOverCapTest is BaseTest {
    function testRejectOverVenueCap() public {
        uint256 idleBefore = stable.balanceOf(address(vault));

        // venue 0 gets 350k > 30% cap (300k). total still <= 80% cap.
        PlanLib.Allocation[] memory allocs = new PlanLib.Allocation[](2);
        allocs[0] = PlanLib.Allocation({venueId: 0, amount: 350_000 ether});
        allocs[1] = PlanLib.Allocation({venueId: 1, amount: 250_000 ether});

        PlanLib.Plan memory plan = PlanLib.Plan({
            planId: keccak256("plan-overcap"),
            modelVersion: MODEL_VERSION,
            codeHash: CODE_HASH,
            nonce: 0,
            expiry: block.timestamp + 3600,
            totalOut: 800_000 ether,
            reserveAmount: 200_000 ether,
            allocations: allocs
        });

        bytes memory sig = _sign(TEE_PK, plan);

        vm.expectRevert(bytes("over venue cap"));
        controller.executePlan(plan, sig);

        // nothing moved
        assertEq(stable.balanceOf(address(vault)), idleBefore);
        assertEq(adapter0.balanceOf(address(vault)), 0);
        assertEq(adapter1.balanceOf(address(vault)), 0);
        assertEq(reserve.balanceOf(address(vault)), 0);
    }
}
