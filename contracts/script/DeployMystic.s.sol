// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {MandateRegistry} from "../src/MandateRegistry.sol";
import {AutomatedCurationVault} from "../src/AutomatedCurationVault.sol";
import {CurationController} from "../src/CurationController.sol";
import {MysticVenueAdapter} from "../src/adapters/MysticVenueAdapter.sol";
import {ReserveAdapter} from "../src/adapters/ReserveAdapter.sol";
import {MysticAddresses} from "../src/MysticAddresses.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IERC4626} from "../src/interfaces/IERC4626.sol";
import {IVault} from "../src/interfaces/IVault.sol";
import {IMandateRegistry} from "../src/interfaces/IMandateRegistry.sol";
import {IReserveAdapter} from "../src/interfaces/IReserveAdapter.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @title DeployMystic (broadcast-less reference)
/// @notice Deploys the full Automated Curation stack wired to the THREE real
///         Mystic Core ERC-4626 vaults on Flare mainnet (FXRP, USDT0, WFLR).
///         The enforcement layer (vault + controller + registry + reserve) is
///         identical to Deploy.s.sol; only the venue adapters change from the
///         MockLendingVenue-backed VenueAdapter to the live MysticVenueAdapter.
///
/// @dev This script does NOT vm.startBroadcast. It is for reference and for
///      running against a local Flare fork (forge script ... --fork-url <rpc>).
///      Each MysticVenueAdapter is constructed with the venue's own underlying
///      token; the constructor asserts the Mystic vault.asset() matches, so a
///      wrong address in MysticAddresses.sol will revert here on a real fork.
contract DeployMystic is Script {
    // caps (bips) - mirror Deploy.s.sol
    uint256 internal constant VENUE_CAP_BIPS = 3000; // 30% per venue (binding)
    // 100%: model routes full capital as venues + reserve; binding guards are the
    // 30% per-venue cap and 20% reserve floor (which force venues <= 80%).
    uint256 internal constant MAX_TOTAL_OUT_BIPS = 10000;
    uint256 internal constant MIN_RESERVE_BIPS = 2000; // 20% floor (binding)
    // Generous absolute defense-in-depth cap per adapter (underlying units).
    uint256 internal constant VENUE_HARD_CAP = type(uint256).max;

    struct Deployed {
        address vault;
        address registry;
        address controller;
        address reserve;
        address fxrpAdapter;
        address usdt0Adapter;
        address wflrAdapter;
    }

    function run() external returns (Deployed memory out) {
        address teeSigner = vm.envAddress("TEE_SIGNER");
        bytes32 codeHash = vm.envBytes32("CODE_HASH");
        uint256 modelVersion = vm.envUint("MODEL_VERSION");

        // The AVV vault holds one stable book-asset for the enforcement stack.
        // In this demo the vault asset is USDT0 (the stable venue); the FXRP and
        // WFLR adapters are additional risk venues the model can route into.
        IERC20 bookAsset = IERC20(MysticAddresses.USDT0_TOKEN);

        AutomatedCurationVault vaultImpl = new AutomatedCurationVault();
        AutomatedCurationVault vault = AutomatedCurationVault(
            address(
                new ERC1967Proxy(
                    address(vaultImpl),
                    abi.encodeCall(
                        AutomatedCurationVault.initialize,
                        (bookAsset)
                    )
                )
            )
        );

        MandateRegistry registryImpl = new MandateRegistry();
        MandateRegistry registry = MandateRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl),
                    abi.encodeCall(MandateRegistry.initialize, ())
                )
            )
        );

        // Three live Mystic venue adapters (venue ids 0=FXRP, 1=USDT0, 2=WFLR).
        MysticVenueAdapter fxrpAdapter = new MysticVenueAdapter(
            IERC20(MysticAddresses.FXRP_TOKEN),
            IERC4626(MysticAddresses.FXRP_VAULT),
            0,
            VENUE_HARD_CAP
        );
        MysticVenueAdapter usdt0Adapter = new MysticVenueAdapter(
            IERC20(MysticAddresses.USDT0_TOKEN),
            IERC4626(MysticAddresses.USDT0_VAULT),
            1,
            VENUE_HARD_CAP
        );
        MysticVenueAdapter wflrAdapter = new MysticVenueAdapter(
            IERC20(MysticAddresses.WFLR_TOKEN),
            IERC4626(MysticAddresses.WFLR_VAULT),
            2,
            VENUE_HARD_CAP
        );

        ReserveAdapter reserve = new ReserveAdapter(bookAsset);

        address[] memory adapters = new address[](3);
        adapters[0] = address(fxrpAdapter);
        adapters[1] = address(usdt0Adapter);
        adapters[2] = address(wflrAdapter);

        CurationController controllerImpl = new CurationController();
        CurationController controller = CurationController(
            address(
                new ERC1967Proxy(
                    address(controllerImpl),
                    abi.encodeCall(
                        CurationController.initialize,
                        (
                            IVault(address(vault)),
                            IMandateRegistry(address(registry)),
                            bookAsset,
                            IReserveAdapter(address(reserve)),
                            adapters
                        )
                    )
                )
            )
        );

        // wiring
        vault.setController(address(controller));
        vault.setAdapters(adapters, address(reserve));
        fxrpAdapter.setController(address(controller));
        usdt0Adapter.setController(address(controller));
        wflrAdapter.setController(address(controller));
        reserve.setController(address(controller));

        // mandate
        registry.setTeeAddress(teeSigner);
        registry.allowVersion(modelVersion, codeHash, "simulated");
        registry.setVenueCapBips(0, VENUE_CAP_BIPS);
        registry.setVenueCapBips(1, VENUE_CAP_BIPS);
        registry.setVenueCapBips(2, VENUE_CAP_BIPS);
        registry.setMaxTotalOutBips(MAX_TOTAL_OUT_BIPS);
        registry.setMinReserveBips(MIN_RESERVE_BIPS);

        out = Deployed({
            vault: address(vault),
            registry: address(registry),
            controller: address(controller),
            reserve: address(reserve),
            fxrpAdapter: address(fxrpAdapter),
            usdt0Adapter: address(usdt0Adapter),
            wflrAdapter: address(wflrAdapter)
        });

        console2.log("Vault              ", out.vault);
        console2.log("MandateRegistry    ", out.registry);
        console2.log("CurationController  ", out.controller);
        console2.log("ReserveAdapter     ", out.reserve);
        console2.log("MysticAdapter FXRP ", out.fxrpAdapter);
        console2.log("MysticAdapter USDT0", out.usdt0Adapter);
        console2.log("MysticAdapter WFLR ", out.wflrAdapter);
    }
}
