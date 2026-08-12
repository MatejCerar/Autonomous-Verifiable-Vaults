// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BaseTest} from "./Base.t.sol";
import {PlanLib} from "../src/libraries/PlanLib.sol";

contract HappyPathTest is BaseTest {
    function testHappyPath() public {
        uint256 navBefore = vault.convertToAssets(1 ether);
        uint256 tvlBefore = vault.totalAssets();

        PlanLib.Allocation[] memory allocs = new PlanLib.Allocation[](2);
        allocs[0] = PlanLib.Allocation({venueId: 0, amount: 250_000 ether});
        allocs[1] = PlanLib.Allocation({venueId: 1, amount: 250_000 ether});

        PlanLib.Plan memory plan = PlanLib.Plan({
            planId: keccak256("plan-1"),
            modelVersion: MODEL_VERSION,
            codeHash: CODE_HASH,
            nonce: 0,
            expiry: block.timestamp + 3600,
            totalOut: 700_000 ether,
            reserveAmount: 200_000 ether,
            allocations: allocs
        });

        bytes memory sig = _sign(TEE_PK, plan);

        assertEq(controller.nonce(), 0);
        controller.executePlan(plan, sig);

        // nonce incremented
        assertEq(controller.nonce(), 1);
        assertTrue(controller.usedPlanIds(plan.planId));

        // balances moved into adapters + reserve; idle drained by totalOut
        assertEq(stable.balanceOf(address(vault)), tvlBefore - 700_000 ether);
        assertEq(adapter0.balanceOf(address(vault)), 250_000 ether);
        assertEq(adapter1.balanceOf(address(vault)), 250_000 ether);
        assertEq(reserve.balanceOf(address(vault)), 200_000 ether);

        // TVL conserved (funds stayed in the system), NAV unchanged
        assertEq(vault.totalAssets(), tvlBefore);
        assertEq(vault.convertToAssets(1 ether), navBefore);
    }
}
