// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {MandateRegistry} from "../src/MandateRegistry.sol";
import {AutomatedCurationVault} from "../src/AutomatedCurationVault.sol";
import {CurationController} from "../src/CurationController.sol";
import {MysticVenueAdapter} from "../src/adapters/MysticVenueAdapter.sol";
import {ReserveAdapter} from "../src/adapters/ReserveAdapter.sol";
import {MockStable} from "../src/mocks/MockStable.sol";
import {MockERC4626Vault} from "../src/mocks/MockERC4626Vault.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IERC4626} from "../src/interfaces/IERC4626.sol";
import {IVault} from "../src/interfaces/IVault.sol";
import {IMandateRegistry} from "../src/interfaces/IMandateRegistry.sol";
import {IReserveAdapter} from "../src/interfaces/IReserveAdapter.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @title DeployTestnet
/// @notice Deploys the FULL Automated Curation stack on Coston2 (chainId 114)
///         with fake money, so an external curator can stand the whole thing up
///         WITHOUT docker, WITHOUT a GCP TEE, and WITHOUT Mystic (which is not on
///         Coston2). It is the testnet twin of DeployMystic.s.sol: the exact same
///         enforcement layer (vault + controller + registry + reserve) and the
///         exact same MysticVenueAdapter production adapter, but each adapter is
///         wired to a MockERC4626Vault instead of a live Mystic Core market.
///
///         SIMPLIFICATION (documented): on this testnet all THREE venues share a
///         single 18-decimal MockStable underlying, so venue routing needs no
///         swap. On mainnet each venue is a distinct real token (FXRP, USDT0,
///         WFLR) with its own Mystic Core vault (see MysticAddresses.sol). The
///         adapter and controller code paths are byte-identical; only the venue
///         backing differs.
///
/// @dev addresses.json (repo root) is written ONLY inside the broadcast path, so
///      a plain fork / dry run (no --broadcast) does NOT clobber the shipped
///      mainnet-prepare default. Env inputs: TEE_SIGNER (address), CODE_HASH
///      (bytes32), MODEL_VERSION (uint, default 1).
contract DeployTestnet is Script {
    // caps (bips) - mirror Deploy.s.sol / DeployMystic.s.sol
    uint256 internal constant VENUE_CAP_BIPS = 3000; // 30% per venue (binding)
    // 100%: the model routes the full capital as venues + reserve each cycle, so
    // total-out is not the binding guard here. The binding protections are the 30%
    // per-venue cap and the 20% reserve floor, which together already force venue
    // deployment <= 80% (reserve >= 20% and totals <= 100% => venues <= 80%).
    uint256 internal constant MAX_TOTAL_OUT_BIPS = 10000;
    uint256 internal constant MIN_RESERVE_BIPS = 2000; // 20% floor (binding)
    uint256 internal constant SEED = 1_000_000 ether; // seed TVL, 18-dec USD
    // Generous absolute defense-in-depth cap per adapter (underlying units).
    uint256 internal constant VENUE_HARD_CAP = type(uint256).max;

    string internal constant ADDR_PATH = "../addresses.json";

    /// @dev Bundles everything written to addresses.json into one memory struct
    ///      so the writer keeps the run() call frame shallow (via-ir depth).
    struct AddrBook {
        address vault;
        address registry;
        address controller;
        address reserve;
        address[] adapters; // venue adapters, id order 0/1/2
        address[] mockVaults; // mock ERC-4626 vaults, id order 0/1/2
        address teeSigner;
        uint256 modelVersion;
        bytes32 codeHash;
    }

    function run() external {
        address teeSigner = vm.envAddress("TEE_SIGNER");
        bytes32 codeHash = vm.envBytes32("CODE_HASH");
        uint256 modelVersion = vm.envOr("MODEL_VERSION", uint256(1));

        // deposit account: prefer DEPOSIT_ACCOUNT, else the broadcast sender.
        address depositAccount = vm.envOr("DEPOSIT_ACCOUNT", msg.sender);

        vm.startBroadcast();

        // Shared 18-dec USD underlying: the vault book-asset AND every venue's
        // underlying (testnet simplification, no swaps needed).
        MockStable stable = new MockStable();

        AutomatedCurationVault vault = _deployVault(stable);
        MandateRegistry registry = _deployRegistry();

        // Three mock ERC-4626 vaults standing in for the Mystic Core markets.
        MockERC4626Vault[3] memory mockVaults = [
            new MockERC4626Vault(
                IERC20(address(stable)),
                "Mystic Core FXRP (mock)",
                "mcFXRP"
            ),
            new MockERC4626Vault(
                IERC20(address(stable)),
                "Mystic Core USDT0 (mock)",
                "mcUSDT0"
            ),
            new MockERC4626Vault(
                IERC20(address(stable)),
                "Mystic Core WFLR (mock)",
                "mcWFLR"
            )
        ];

        // Same production adapter as mainnet, one per mock vault, id order 0/1/2.
        MysticVenueAdapter[3] memory venueAdapters = [
            new MysticVenueAdapter(
                IERC20(address(stable)),
                IERC4626(address(mockVaults[0])),
                0,
                VENUE_HARD_CAP
            ),
            new MysticVenueAdapter(
                IERC20(address(stable)),
                IERC4626(address(mockVaults[1])),
                1,
                VENUE_HARD_CAP
            ),
            new MysticVenueAdapter(
                IERC20(address(stable)),
                IERC4626(address(mockVaults[2])),
                2,
                VENUE_HARD_CAP
            )
        ];

        ReserveAdapter reserve = new ReserveAdapter(IERC20(address(stable)));

        address[] memory adapters = new address[](3);
        adapters[0] = address(venueAdapters[0]);
        adapters[1] = address(venueAdapters[1]);
        adapters[2] = address(venueAdapters[2]);

        CurationController controller = _deployController(
            vault,
            registry,
            IERC20(address(stable)),
            reserve,
            adapters
        );

        // wiring
        vault.setController(address(controller));
        vault.setAdapters(adapters, address(reserve));
        venueAdapters[0].setController(address(controller));
        venueAdapters[1].setController(address(controller));
        venueAdapters[2].setController(address(controller));
        reserve.setController(address(controller));

        // mandate: register the (simulated) TEE signer + fingerprint + caps.
        registry.setTeeAddress(teeSigner);
        registry.allowVersion(modelVersion, codeHash, "simulated");
        registry.setVenueCapBips(0, VENUE_CAP_BIPS);
        registry.setVenueCapBips(1, VENUE_CAP_BIPS);
        registry.setVenueCapBips(2, VENUE_CAP_BIPS);
        registry.setMaxTotalOutBips(MAX_TOTAL_OUT_BIPS);
        registry.setMinReserveBips(MIN_RESERVE_BIPS);

        // seed TVL: mint fake USD and deposit into the vault.
        stable.mint(depositAccount, SEED);
        if (depositAccount == msg.sender) {
            stable.approve(address(vault), SEED);
            vault.deposit(SEED, depositAccount);
        } else {
            vm.stopBroadcast();
            vm.startPrank(depositAccount);
            stable.approve(address(vault), SEED);
            vault.deposit(SEED, depositAccount);
            vm.stopPrank();
            vm.startBroadcast();
        }

        AddrBook memory book;
        book.vault = address(vault);
        book.registry = address(registry);
        book.controller = address(controller);
        book.reserve = address(reserve);
        book.adapters = adapters;
        book.mockVaults = new address[](3);
        book.mockVaults[0] = address(mockVaults[0]);
        book.mockVaults[1] = address(mockVaults[1]);
        book.mockVaults[2] = address(mockVaults[2]);
        book.teeSigner = teeSigner;
        book.modelVersion = modelVersion;
        book.codeHash = codeHash;

        // Written ONLY when actually broadcasting (`--broadcast`), so a plain
        // fork / dry run (which still executes the script body in simulation)
        // does NOT overwrite the shipped root addresses.json.
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            _writeAddresses(book);
        }

        vm.stopBroadcast();

        _logAddresses(book);
    }

    // --- deploy helpers (kept small so run() stays shallow for via-ir) ---

    function _deployVault(
        MockStable stable
    ) internal returns (AutomatedCurationVault) {
        AutomatedCurationVault impl = new AutomatedCurationVault();
        return
            AutomatedCurationVault(
                address(
                    new ERC1967Proxy(
                        address(impl),
                        abi.encodeCall(
                            AutomatedCurationVault.initialize,
                            (IERC20(address(stable)))
                        )
                    )
                )
            );
    }

    function _deployRegistry() internal returns (MandateRegistry) {
        MandateRegistry impl = new MandateRegistry();
        return
            MandateRegistry(
                address(
                    new ERC1967Proxy(
                        address(impl),
                        abi.encodeCall(MandateRegistry.initialize, ())
                    )
                )
            );
    }

    function _deployController(
        AutomatedCurationVault vault,
        MandateRegistry registry,
        IERC20 stable,
        ReserveAdapter reserve,
        address[] memory adapters
    ) internal returns (CurationController) {
        CurationController impl = new CurationController();
        return
            CurationController(
                address(
                    new ERC1967Proxy(
                        address(impl),
                        abi.encodeCall(
                            CurationController.initialize,
                            (
                                IVault(address(vault)),
                                IMandateRegistry(address(registry)),
                                stable,
                                IReserveAdapter(address(reserve)),
                                adapters
                            )
                        )
                    )
                )
            );
    }

    function _logAddresses(AddrBook memory book) internal pure {
        console2.log("Vault             ", book.vault);
        console2.log("MandateRegistry   ", book.registry);
        console2.log("CurationController ", book.controller);
        console2.log("ReserveAdapter    ", book.reserve);
        console2.log("VenueAdapter0 FXRP", book.adapters[0]);
        console2.log("VenueAdapter1 USDT", book.adapters[1]);
        console2.log("VenueAdapter2 WFLR", book.adapters[2]);
        console2.log("MockVault0        ", book.mockVaults[0]);
        console2.log("MockVault1        ", book.mockVaults[1]);
        console2.log("MockVault2        ", book.mockVaults[2]);
    }

    /// @notice Writes ../addresses.json in EXACTLY the schema the tee-model
    ///         config.ts Addresses interface consumes (see task spec). Only the
    ///         `venueAdapters` and `mysticVaults` arrays and the deployed slots
    ///         differ from the mainnet default; here mysticVaults holds the mock
    ///         ERC-4626 vaults standing in for Mystic Core markets.
    function _writeAddresses(AddrBook memory book) internal {
        string memory root = "root";
        vm.serializeUint(root, "chainId", uint256(114));
        vm.serializeString(root, "network", "coston2");
        vm.serializeString(
            root,
            "rpcUrl",
            "https://coston2-api.flare.network/ext/C/rpc"
        );
        vm.serializeString(
            root,
            "contractRegistry",
            "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019"
        );
        vm.serializeString(
            root,
            "flrUsdFeedId",
            "0x01464c522f55534400000000000000000000000000"
        );
        vm.serializeString(
            root,
            "xrpUsdFeedId",
            "0x015852502f55534400000000000000000000000000"
        );
        vm.serializeAddress(root, "teeSignerAddress", book.teeSigner);
        vm.serializeString(
            root,
            "modelVersion",
            vm.toString(book.modelVersion)
        );
        vm.serializeBytes32(root, "codeHash", book.codeHash);

        // nested "deployed" object
        string memory dep = "deployed";
        vm.serializeAddress(dep, "vault", book.vault);
        vm.serializeAddress(dep, "mandateRegistry", book.registry);
        vm.serializeAddress(dep, "curationController", book.controller);
        vm.serializeAddress(dep, "reserveAdapter", book.reserve);
        vm.serializeAddress(dep, "venueAdapters", book.adapters);
        string memory depJson = vm.serializeAddress(
            dep,
            "mysticVaults",
            book.mockVaults
        );

        string memory json = vm.serializeString(root, "deployed", depJson);
        vm.writeJson(json, ADDR_PATH);
    }
}
