// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BaseTest} from "./Base.t.sol";
import {PlanLib} from "../src/libraries/PlanLib.sol";

contract ReserveRoutingTest is BaseTest {
    function testReserveRoutingAllToReserve() public {
        uint256 tvlBefore = vault.totalAssets();

        // defensive mode: no allocations, everything to reserve
        PlanLib.Plan memory plan = PlanLib.Plan({
            planId: keccak256("plan-reserve"),
            modelVersion: MODEL_VERSION,
            codeHash: CODE_HASH,
            nonce: 0,
            expiry: block.timestamp + 3600,
            totalOut: 800_000 ether,
            reserveAmount: 800_000 ether,
            allocations: _emptyAllocs()
        });

        bytes memory sig = _sign(TEE_PK, plan);
        controller.executePlan(plan, sig);

        assertEq(controller.nonce(), 1);
        assertEq(reserve.balanceOf(address(vault)), 800_000 ether);
        assertEq(adapter0.balanceOf(address(vault)), 0);
        assertEq(adapter1.balanceOf(address(vault)), 0);
        assertEq(
            stable.balanceOf(address(vault)),
            tvlBefore - 800_000 ether
        );
        // TVL conserved
        assertEq(vault.totalAssets(), tvlBefore);
    }
}
