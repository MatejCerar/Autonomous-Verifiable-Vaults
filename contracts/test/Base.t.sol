// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {PlanLib} from "../src/libraries/PlanLib.sol";
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

contract BaseTest is Test {
    MockStable internal stable;
    MockLendingVenue internal venue0;
    MockLendingVenue internal venue1;
    VenueAdapter internal adapter0;
    VenueAdapter internal adapter1;
    ReserveAdapter internal reserve;
    MandateRegistry internal registry;
    AutomatedCurationVault internal vault;
    CurationController internal controller;

    uint256 internal constant TEE_PK = 0xA11CE;
    address internal teeSigner;
    uint256 internal constant MODEL_VERSION = 1;
    bytes32 internal constant CODE_HASH = keccak256("model-module-bytes");

    // caps
    uint256 internal constant VENUE_CAP_BIPS = 3000;
    uint256 internal constant MAX_TOTAL_OUT_BIPS = 8000;
    uint256 internal constant MIN_RESERVE_BIPS = 2000;

    address internal depositor = address(0xDEADBEEF);
    uint256 internal constant SEED = 1_000_000 ether;

    function setUp() public virtual {
        teeSigner = vm.addr(TEE_PK);

        stable = new MockStable();

        AutomatedCurationVault vaultImpl = new AutomatedCurationVault();
        vault = AutomatedCurationVault(
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
        registry = MandateRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl),
                    abi.encodeCall(MandateRegistry.initialize, ())
                )
            )
        );

        venue0 = new MockLendingVenue(IERC20(address(stable)));
        venue1 = new MockLendingVenue(IERC20(address(stable)));

        // absolute hard caps high enough not to interfere with mandate caps
        adapter0 = new VenueAdapter(
            IERC20(address(stable)),
            venue0,
            0,
            SEED
        );
        adapter1 = new VenueAdapter(
            IERC20(address(stable)),
            venue1,
            1,
            SEED
        );
        reserve = new ReserveAdapter(IERC20(address(stable)));

        address[] memory adapters = new address[](2);
        adapters[0] = address(adapter0);
        adapters[1] = address(adapter1);

        CurationController controllerImpl = new CurationController();
        controller = CurationController(
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
        registry.allowVersion(MODEL_VERSION, CODE_HASH, "simulated");
        registry.setVenueCapBips(0, VENUE_CAP_BIPS);
        registry.setVenueCapBips(1, VENUE_CAP_BIPS);
        registry.setMaxTotalOutBips(MAX_TOTAL_OUT_BIPS);
        registry.setMinReserveBips(MIN_RESERVE_BIPS);

        // seed TVL via a deposit
        stable.mint(depositor, SEED);
        vm.startPrank(depositor);
        stable.approve(address(vault), SEED);
        vault.deposit(SEED, depositor);
        vm.stopPrank();
    }

    // --- plan helpers ---

    function _emptyAllocs()
        internal
        pure
        returns (PlanLib.Allocation[] memory)
    {
        return new PlanLib.Allocation[](0);
    }

    function _sign(
        uint256 pk,
        PlanLib.Plan memory plan
    ) internal view returns (bytes memory) {
        bytes32 planHash = _hashPlan(plan);
        bytes32 ethHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", planHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    // Mirrors PlanLib.hashPlan but usable on a memory Plan in tests.
    function _hashPlan(
        PlanLib.Plan memory plan
    ) internal view returns (bytes32) {
        bytes32 allocHash = keccak256(abi.encode(plan.allocations));
        return
            keccak256(
                abi.encodePacked(
                    address(controller),
                    block.chainid,
                    plan.planId,
                    plan.modelVersion,
                    plan.codeHash,
                    plan.nonce,
                    plan.expiry,
                    plan.totalOut,
                    plan.reserveAmount,
                    allocHash
                )
            );
    }
}
