// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BaseTest} from "./Base.t.sol";
import {PlanLib} from "../src/libraries/PlanLib.sol";

contract RejectBadSignerTest is BaseTest {
    uint256 internal constant ROGUE_PK = 0xB0B;

    function testRejectBadSigner() public {
        PlanLib.Allocation[] memory allocs = new PlanLib.Allocation[](2);
        allocs[0] = PlanLib.Allocation({venueId: 0, amount: 250_000 ether});
        allocs[1] = PlanLib.Allocation({venueId: 1, amount: 250_000 ether});

        PlanLib.Plan memory plan = PlanLib.Plan({
            planId: keccak256("plan-badsigner"),
            modelVersion: MODEL_VERSION,
            codeHash: CODE_HASH,
            nonce: 0,
            expiry: block.timestamp + 3600,
            totalOut: 700_000 ether,
            reserveAmount: 200_000 ether,
            allocations: allocs
        });

        // signed by an unregistered key
        bytes memory sig = _sign(ROGUE_PK, plan);

        vm.expectRevert(bytes("bad signer"));
        controller.executePlan(plan, sig);

        assertEq(adapter0.balanceOf(address(vault)), 0);
        assertEq(reserve.balanceOf(address(vault)), 0);
    }
}
