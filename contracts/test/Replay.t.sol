// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BaseTest} from "./Base.t.sol";
import {PlanLib} from "../src/libraries/PlanLib.sol";

contract ReplayTest is BaseTest {
    function testReplay() public {
        PlanLib.Allocation[] memory allocs = new PlanLib.Allocation[](2);
        allocs[0] = PlanLib.Allocation({venueId: 0, amount: 250_000 ether});
        allocs[1] = PlanLib.Allocation({venueId: 1, amount: 250_000 ether});

        PlanLib.Plan memory plan = PlanLib.Plan({
            planId: keccak256("plan-replay"),
            modelVersion: MODEL_VERSION,
            codeHash: CODE_HASH,
            nonce: 0,
            expiry: block.timestamp + 3600,
            totalOut: 700_000 ether,
            reserveAmount: 200_000 ether,
            allocations: allocs
        });

        bytes memory sig = _sign(TEE_PK, plan);

        // first execution succeeds
        controller.executePlan(plan, sig);

        // reusing the same planId reverts "replay" (checked first, before nonce)
        vm.expectRevert(bytes("replay"));
        controller.executePlan(plan, sig);
    }
}
