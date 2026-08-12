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

/// @notice Deploys the full Automated Curation stack, wires it, seeds TVL, then
///         writes deployed addresses back into ../addresses.json and exports the
///         contract ABIs to ../abi/<Name>.json.
contract Deploy is Script {
    /// @dev Bundles every value written to addresses.json so it can be passed
    ///      to _writeAddresses as one memory struct (keeps the run() call frame
    ///      shallow enough for via-ir).
    struct AddrBook {
        address stable;
        address vault;
        address registry;
        address controller;
        address reserve;
        address[] adapters;
        address venue0;
        address venue1;
        address teeSigner;
        uint256 modelVersion;
        bytes32 codeHash;
        address mandateRegistryImpl;
        address curationControllerImpl;
        address vaultImpl;
    }

    // caps (bips)
    uint256 internal constant VENUE_CAP_BIPS = 3000; // 30% per venue
    uint256 internal constant MAX_TOTAL_OUT_BIPS = 8000; // 80% per cycle
    uint256 internal constant MIN_RESERVE_BIPS = 2000; // 20% floor
    uint256 internal constant SEED = 1_000_000 ether;
    uint256 internal constant VENUE_HARD_CAP = 500_000 ether;

    string internal constant ADDR_PATH = "../addresses.json";
    string internal constant ABI_DIR = "../abi/";

    function run() external {
        address teeSigner = vm.envAddress("TEE_SIGNER");
        bytes32 codeHash = vm.envBytes32("CODE_HASH");
        uint256 modelVersion = vm.envUint("MODEL_VERSION");

        // deposit account: prefer DEPOSIT_ACCOUNT, else the broadcast sender
        address depositAccount = vm.envOr(
            "DEPOSIT_ACCOUNT",
            msg.sender
        );

        vm.startBroadcast();

        MockStable stable = new MockStable();

        AutomatedCurationVault vaultImpl = new AutomatedCurationVault();
        AutomatedCurationVault vault = AutomatedCurationVault(
            address(
                new ERC1967Proxy(
                    address(vaultImpl),
                    abi.encodeCall(
                        AutomatedCurationVault.initialize,
                        (IERC20(address(stable)))
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

        MockLendingVenue venue0 = new MockLendingVenue(
            IERC20(address(stable))
        );
        MockLendingVenue venue1 = new MockLendingVenue(
            IERC20(address(stable))
        );

        VenueAdapter adapter0 = new VenueAdapter(
            IERC20(address(stable)),
            venue0,
            0,
            VENUE_HARD_CAP
        );
        VenueAdapter adapter1 = new VenueAdapter(
            IERC20(address(stable)),
            venue1,
            1,
            VENUE_HARD_CAP
        );
        ReserveAdapter reserve = new ReserveAdapter(
            IERC20(address(stable))
        );

        address[] memory adapters = new address[](2);
        adapters[0] = address(adapter0);
        adapters[1] = address(adapter1);

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
                            IERC20(address(stable)),
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
        adapter0.setController(address(controller));
        adapter1.setController(address(controller));
        reserve.setController(address(controller));

        // mandate
        registry.setTeeAddress(teeSigner);
        registry.allowVersion(modelVersion, codeHash, "simulated");
        registry.setVenueCapBips(0, VENUE_CAP_BIPS);
        registry.setVenueCapBips(1, VENUE_CAP_BIPS);
        registry.setMaxTotalOutBips(MAX_TOTAL_OUT_BIPS);
        registry.setMinReserveBips(MIN_RESERVE_BIPS);

        // seed TVL: mint to deposit account and deposit into the vault
        stable.mint(depositAccount, SEED);
        vm.stopBroadcast();

        vm.startBroadcast();
        // deposit must come from the deposit account
        vm.stopBroadcast();

        // Perform the deposit as the deposit account. When run with a single
        // broadcast key that equals depositAccount this is a real tx; otherwise
        // we prank so seeding still succeeds against a local fork.
        if (depositAccount == msg.sender) {
            vm.startBroadcast();
            stable.approve(address(vault), SEED);
            vault.deposit(SEED, depositAccount);
            vm.stopBroadcast();
        } else {
            vm.startPrank(depositAccount);
            stable.approve(address(vault), SEED);
            vault.deposit(SEED, depositAccount);
            vm.stopPrank();
        }

        AddrBook memory book;
        book.stable = address(stable);
        book.vault = address(vault);
        book.registry = address(registry);
        book.controller = address(controller);
        book.reserve = address(reserve);
        book.adapters = adapters;
        book.venue0 = address(venue0);
        book.venue1 = address(venue1);
        book.teeSigner = teeSigner;
        book.modelVersion = modelVersion;
        book.codeHash = codeHash;
        book.mandateRegistryImpl = address(registryImpl);
        book.curationControllerImpl = address(controllerImpl);
        book.vaultImpl = address(vaultImpl);
        _writeAddresses(book);

        _exportAbis();

        _logAddresses(book);
    }

    function _logAddresses(AddrBook memory book) internal pure {
        console2.log("MockStable        ", book.stable);
        console2.log("Vault             ", book.vault);
        console2.log("MandateRegistry   ", book.registry);
        console2.log("CurationController ", book.controller);
        console2.log("ReserveAdapter    ", book.reserve);
        console2.log("VenueAdapter0     ", book.adapters[0]);
        console2.log("VenueAdapter1     ", book.adapters[1]);
        console2.log("MockVenue0        ", book.venue0);
        console2.log("MockVenue1        ", book.venue1);
    }

    function _writeAddresses(AddrBook memory book) internal {
        // Rebuild the frozen addresses.json shape, filling the deploy slots.
        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeString(root, "network", "coston2-fork");
        vm.serializeString(root, "rpcUrl", "http://127.0.0.1:8545");
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
        vm.serializeAddress(root, "teeSignerAddress", book.teeSigner);
        vm.serializeString(
            root,
            "modelVersion",
            vm.toString(book.modelVersion)
        );
        vm.serializeBytes32(root, "codeHash", book.codeHash);

        // nested "deployed" object
        string memory dep = "deployed";
        vm.serializeAddress(dep, "mockStable", book.stable);
        vm.serializeAddress(dep, "vault", book.vault);
        vm.serializeAddress(dep, "mandateRegistry", book.registry);
        vm.serializeAddress(dep, "curationController", book.controller);
        vm.serializeAddress(dep, "reserveAdapter", book.reserve);

        address[] memory venues = new address[](2);
        venues[0] = book.venue0;
        venues[1] = book.venue1;
        vm.serializeAddress(dep, "venueAdapters", book.adapters);
        string memory depJson = vm.serializeAddress(
            dep,
            "mockVenues",
            venues
        );

        // nested "implementations" object (UUPS impl addresses behind the
        // proxies above; the "deployed" addresses are the PROXY addresses).
        string memory impl = "implementations";
        vm.serializeAddress(
            impl,
            "mandateRegistryImpl",
            book.mandateRegistryImpl
        );
        vm.serializeAddress(
            impl,
            "curationControllerImpl",
            book.curationControllerImpl
        );
        string memory implJson = vm.serializeAddress(
            impl,
            "vaultImpl",
            book.vaultImpl
        );

        vm.serializeString(root, "deployed", depJson);
        string memory json = vm.serializeString(
            root,
            "implementations",
            implJson
        );
        vm.writeJson(json, ADDR_PATH);
    }

    function _exportAbis() internal {
        string[9] memory names = [
            "MockStable",
            "AutomatedCurationVault",
            "MandateRegistry",
            "CurationController",
            "ReserveAdapter",
            "VenueAdapter",
            "MockLendingVenue",
            "PlanLib",
            "IMandateRegistry"
        ];
        for (uint256 i = 0; i < names.length; i++) {
            string memory outPath = string.concat(
                "out/",
                names[i],
                ".sol/",
                names[i],
                ".json"
            );
            string memory artifact = vm.readFile(outPath);
            string memory destination = string.concat(
                ABI_DIR,
                names[i],
                ".json"
            );
            // artifact.abi is a JSON array; extract it raw and write out.
            vm.writeFile(destination, _extractAbi(artifact));
        }
    }

    /// @notice Pull the ".abi" array out of a forge artifact JSON as a raw string.
    function _extractAbi(
        string memory artifact
    ) internal pure returns (string memory) {
        bytes memory data = bytes(artifact);
        // find "\"abi\":"
        bytes memory key = bytes("\"abi\":");
        int256 start = _indexOf(data, key);
        require(start >= 0, "abi key not found");
        uint256 i = uint256(start) + key.length;
        // skip whitespace to the opening bracket
        while (i < data.length && data[i] != "[") {
            i++;
        }
        require(i < data.length, "abi array not found");
        uint256 depth = 0;
        uint256 begin = i;
        bool inStr = false;
        for (; i < data.length; i++) {
            bytes1 c = data[i];
            if (inStr) {
                if (c == "\\") {
                    i++;
                } else if (c == '"') {
                    inStr = false;
                }
                continue;
            }
            if (c == '"') {
                inStr = true;
            } else if (c == "[") {
                depth++;
            } else if (c == "]") {
                depth--;
                if (depth == 0) {
                    uint256 len = i - begin + 1;
                    bytes memory outb = new bytes(len);
                    for (uint256 j = 0; j < len; j++) {
                        outb[j] = data[begin + j];
                    }
                    return string(outb);
                }
            }
        }
        revert("abi array unterminated");
    }

    function _indexOf(
        bytes memory haystack,
        bytes memory needle
    ) internal pure returns (int256) {
        if (needle.length == 0 || haystack.length < needle.length) {
            return -1;
        }
        for (uint256 i = 0; i <= haystack.length - needle.length; i++) {
            bool matched = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    matched = false;
                    break;
                }
            }
            if (matched) {
                return int256(i);
            }
        }
        return -1;
    }
}
