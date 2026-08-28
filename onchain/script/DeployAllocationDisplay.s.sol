// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console} from "forge-std/Script.sol";
import {AllocationDisplay} from "../src/AllocationDisplay.sol";

/// @notice Deploys AllocationDisplay with `updater = msg.sender` (the deployer,
///         i.e. the demo relayer key) and prints the address.
///
/// Usage (Coston2):
///   forge script script/DeployAllocationDisplay.s.sol:DeployAllocationDisplay \
///     --rpc-url https://coston2-api.flare.network/ext/C/rpc \
///     --private-key $DEMO_SIGNER_KEY --broadcast
contract DeployAllocationDisplay is Script {
    function run() external returns (AllocationDisplay display) {
        vm.startBroadcast();
        display = new AllocationDisplay(msg.sender);
        vm.stopBroadcast();

        console.log("AllocationDisplay deployed at:", address(display));
        console.log("updater (relayer):", display.updater());
    }
}
