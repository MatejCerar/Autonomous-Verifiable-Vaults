// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {AllocationDisplay} from "../src/AllocationDisplay.sol";

contract AllocationDisplayTest is Test {
    AllocationDisplay display;
    address updater = address(0xBEEF);
    address stranger = address(0xCAFE);

    function setUp() public {
        display = new AllocationDisplay(updater);
    }

    function testPushAndReadLatest() public {
        bytes32 planId = keccak256("plan-1");
        uint256[3] memory amounts = [uint256(30e16), uint256(30e16), uint256(20e16)];

        vm.prank(updater);
        uint256 id = display.pushCycle(planId, 1e18, 20e16, amounts);

        assertEq(id, 1);
        assertEq(display.cycleCount(), 1);

        AllocationDisplay.Cycle memory c = display.latest();
        assertEq(c.planId, planId);
        assertEq(c.totalOut, 1e18);
        assertEq(c.reserveAmount, 20e16);
        assertEq(c.amounts[0], 30e16);
        assertEq(c.amounts[1], 30e16);
        assertEq(c.amounts[2], 20e16);
        assertEq(c.cycleId, 1);
        assertEq(c.timestamp, uint64(block.timestamp));
    }

    function testMonotonicCounter() public {
        uint256[3] memory a = [uint256(1), uint256(2), uint256(3)];
        vm.startPrank(updater);
        display.pushCycle(keccak256("a"), 6, 0, a);
        display.pushCycle(keccak256("b"), 6, 0, a);
        vm.stopPrank();

        assertEq(display.cycleCount(), 2);
        assertEq(display.latest().cycleId, 2);
        assertEq(display.latest().planId, keccak256("b"));
    }

    function testOnlyUpdaterCanPush() public {
        uint256[3] memory a = [uint256(1), uint256(2), uint256(3)];
        vm.prank(stranger);
        vm.expectRevert(AllocationDisplay.NotUpdater.selector);
        display.pushCycle(keccak256("x"), 6, 0, a);
    }

    function testLatestBeforeAnyPush() public view {
        AllocationDisplay.Cycle memory c = display.latest();
        assertEq(c.cycleId, 0);
        assertEq(c.planId, bytes32(0));
    }
}
