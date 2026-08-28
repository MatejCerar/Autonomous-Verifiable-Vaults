// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {MandateRegistry} from "../src/MandateRegistry.sol";
import {AutomatedCurationVault} from "../src/AutomatedCurationVault.sol";
import {CurationController} from "../src/CurationController.sol";
import {VenueAdapter} from "../src/adapters/VenueAdapter.sol";
import {ReserveAdapter} from "../src/adapters/ReserveAdapter.sol";
import {MockStable} from "../src/mocks/MockStable.sol";
import {MockLendingVenue} from "../src/mocks/MockLendingVenue.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IVault} from "../src/interfaces/IVault.sol";
import {IMandateRegistry} from "../src/interfaces/IMandateRegistry.sol";
import {IReserveAdapter} from "../src/interfaces/IReserveAdapter.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// AVV enforcement stack for Coston2, 3 venues (FXRP=0, USDT0=1, WFLR=2), mock
// ERC-4626 venues (Mystic is mainnet-only). maxTotalOut = 100% because the model
// routes the whole capital as venues + reserve; the binding guards are the 30%
// venue cap and 20% reserve floor. Env: TEE_SIGNER, CODE_HASH, MODEL_VERSION.
contract DeployCoston2 is Script {
    uint256 constant VENUE_CAP_BIPS = 3000; // 30%
    uint256 constant MAX_TOTAL_OUT_BIPS = 10000; // 100%
    uint256 constant MIN_RESERVE_BIPS = 2000; // 20%
    uint256 constant SEED = 1_000_000 ether; // 1e24 = $1,000,000 (18dp)
    uint256 constant VENUE_HARD_CAP = 500_000 ether;

    function run() external {
        address teeSigner = vm.envAddress("TEE_SIGNER");
        bytes32 codeHash = vm.envBytes32("CODE_HASH");
        uint256 modelVersion = vm.envUint("MODEL_VERSION");
        address depositAccount = vm.envOr("DEPOSIT_ACCOUNT", msg.sender);

        vm.startBroadcast();

        MockStable stable = new MockStable();

        AutomatedCurationVault vault = AutomatedCurationVault(
            address(
                new ERC1967Proxy(
                    address(new AutomatedCurationVault()),
                    abi.encodeCall(
                        AutomatedCurationVault.initialize,
                        (IERC20(address(stable)))
                    )
                )
            )
        );

        MandateRegistry registry = MandateRegistry(
            address(
                new ERC1967Proxy(
                    address(new MandateRegistry()),
                    abi.encodeCall(MandateRegistry.initialize, ())
                )
            )
        );

        address[] memory adapters = new address[](3);
        address[] memory venues = new address[](3);
        for (uint256 i = 0; i < 3; i++) {
            MockLendingVenue venue = new MockLendingVenue(IERC20(address(stable)));
            VenueAdapter adapter = new VenueAdapter(
                IERC20(address(stable)),
                venue,
                i,
                VENUE_HARD_CAP
            );
            venues[i] = address(venue);
            adapters[i] = address(adapter);
        }
        ReserveAdapter reserve = new ReserveAdapter(IERC20(address(stable)));

        CurationController controller = CurationController(
            address(
                new ERC1967Proxy(
                    address(new CurationController()),
                    abi.encodeCall(
                        CurationController.initialize,
                        (
                            IVault(address(vault)),
                            IMandateRegistry(address(registry)),
                            IERC20(address(stable)),
                            IReserveAdapter(address(reserve)),
                            adapters
                        )
                    )
                )
            )
        );

        vault.setController(address(controller));
        vault.setAdapters(adapters, address(reserve));
        for (uint256 i = 0; i < 3; i++) {
            VenueAdapter(adapters[i]).setController(address(controller));
            registry.setVenueCapBips(i, VENUE_CAP_BIPS);
        }
        reserve.setController(address(controller));

        registry.setTeeAddress(teeSigner);
        registry.allowVersion(modelVersion, codeHash, "simulated");
        registry.setMaxTotalOutBips(MAX_TOTAL_OUT_BIPS);
        registry.setMinReserveBips(MIN_RESERVE_BIPS);

        stable.mint(depositAccount, SEED);
        if (depositAccount == msg.sender) {
            stable.approve(address(vault), SEED);
            vault.deposit(SEED, depositAccount);
        }

        vm.stopBroadcast();

        console2.log("MockStable        ", address(stable));
        console2.log("Vault             ", address(vault));
        console2.log("MandateRegistry   ", address(registry));
        console2.log("CurationController ", address(controller));
        console2.log("ReserveAdapter    ", address(reserve));
        console2.log("VenueAdapter0     ", adapters[0]);
        console2.log("VenueAdapter1     ", adapters[1]);
        console2.log("VenueAdapter2     ", adapters[2]);
        console2.log("teeSigner         ", teeSigner);

        string memory root = "deployed";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeAddress(root, "mockStable", address(stable));
        vm.serializeAddress(root, "vault", address(vault));
        vm.serializeAddress(root, "mandateRegistry", address(registry));
        vm.serializeAddress(root, "curationController", address(controller));
        vm.serializeAddress(root, "reserveAdapter", address(reserve));
        vm.serializeAddress(root, "venueAdapters", adapters);
        vm.serializeAddress(root, "mockVenues", venues);
        vm.serializeAddress(root, "teeSigner", teeSigner);
        vm.serializeUint(root, "modelVersion", modelVersion);
        string memory json = vm.serializeBytes32(root, "codeHash", codeHash);
        vm.writeJson(json, "../deployed.coston2.json");
    }
}
