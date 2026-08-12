// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BaseTest} from "./Base.t.sol";
import {PlanLib} from "../src/libraries/PlanLib.sol";

contract ExpiredTest is BaseTest {
    function testExpired() public {
        // move time forward so a past expiry is expressible
        vm.warp(block.timestamp + 10_000);

        PlanLib.Allocation[] memory allocs = new PlanLib.Allocation[](2);
        allocs[0] = PlanLib.Allocation({venueId: 0, amount: 250_000 ether});
        allocs[1] = PlanLib.Allocation({venueId: 1, amount: 250_000 ether});

        PlanLib.Plan memory plan = PlanLib.Plan({
            planId: keccak256("plan-expired"),
            modelVersion: MODEL_VERSION,
            codeHash: CODE_HASH,
            nonce: 0,
            expiry: block.timestamp - 1,
            totalOut: 700_000 ether,
            reserveAmount: 200_000 ether,
            allocations: allocs
        });

        bytes memory sig = _sign(TEE_PK, plan);

        vm.expectRevert(bytes("expired"));
        controller.executePlan(plan, sig);

        assertEq(adapter0.balanceOf(address(vault)), 0);
    }
}
