// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {PlanLib} from "../src/libraries/PlanLib.sol";
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

/// @title DeployTestnetCycle
/// @notice In-process proof that the Coston2-deployable stack (MockStable +
///         3x MockERC4626Vault + MysticVenueAdapter + full enforcement layer)
///         runs a live curation cycle end to end with NO network, NO docker,
///         NO TEE. This mirrors, in Solidity, exactly what DeployTestnet.s.sol
///         stands up and what scripts/cycle.sh submits.
contract DeployTestnetCycleTest is Test {
    // The full testnet stack (same wiring as DeployTestnet.s.sol).
    MockStable internal stable;
    MockERC4626Vault[3] internal mockVaults;
    MysticVenueAdapter[3] internal venueAdapters;
    ReserveAdapter internal reserve;
    MandateRegistry internal registry;
    AutomatedCurationVault internal vault;
    CurationController internal controller;

    // TEE key we control (stand-in for the simulated TEE signer).
    uint256 internal constant TEE_PK = 0xA11CE;
    address internal teeSigner;
    uint256 internal constant MODEL_VERSION = 1;
    bytes32 internal constant CODE_HASH = keccak256("model-module-bytes");

    uint256 internal constant VENUE_CAP_BIPS = 3000; // 30%
    uint256 internal constant MAX_TOTAL_OUT_BIPS = 8000; // 80%
    uint256 internal constant MIN_RESERVE_BIPS = 2000; // 20%

    address internal depositor = address(0xDEADBEEF);
    uint256 internal constant SEED = 1_000_000 ether;

    function setUp() public {
        teeSigner = vm.addr(TEE_PK);
        _deployStack();
    }

    /// @dev Rebuilds the DeployTestnet.s.sol stack in-process, setting the TEE
    ///      address to a key this test controls.
    function _deployStack() internal {
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

        string[3] memory names = [
            "Mystic Core FXRP (mock)",
            "Mystic Core USDT0 (mock)",
            "Mystic Core WFLR (mock)"
        ];
        string[3] memory syms = ["mcFXRP", "mcUSDT0", "mcWFLR"];
        for (uint256 i = 0; i < 3; i++) {
            mockVaults[i] = new MockERC4626Vault(
                IERC20(address(stable)),
                names[i],
                syms[i]
            );
            venueAdapters[i] = new MysticVenueAdapter(
                IERC20(address(stable)),
                IERC4626(address(mockVaults[i])),
                i,
                type(uint256).max
            );
        }

        reserve = new ReserveAdapter(IERC20(address(stable)));

        address[] memory adapters = new address[](3);
        adapters[0] = address(venueAdapters[0]);
        adapters[1] = address(venueAdapters[1]);
        adapters[2] = address(venueAdapters[2]);

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
        venueAdapters[0].setController(address(controller));
        venueAdapters[1].setController(address(controller));
        venueAdapters[2].setController(address(controller));
        reserve.setController(address(controller));

        // mandate (TEE address set to our controllable key)
        registry.setTeeAddress(teeSigner);
        registry.allowVersion(MODEL_VERSION, CODE_HASH, "simulated");
        registry.setVenueCapBips(0, VENUE_CAP_BIPS);
        registry.setVenueCapBips(1, VENUE_CAP_BIPS);
        registry.setVenueCapBips(2, VENUE_CAP_BIPS);
        registry.setMaxTotalOutBips(MAX_TOTAL_OUT_BIPS);
        registry.setMinReserveBips(MIN_RESERVE_BIPS);

        // seed TVL
        stable.mint(depositor, SEED);
        vm.startPrank(depositor);
        stable.approve(address(vault), SEED);
        vault.deposit(SEED, depositor);
        vm.stopPrank();
    }

    // --- plan helpers ---

    function _sign(
        uint256 pk,
        PlanLib.Plan memory plan
    ) internal view returns (bytes memory) {
        bytes32 allocHash = keccak256(abi.encode(plan.allocations));
        bytes32 planHash = keccak256(
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
        bytes32 ethHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", planHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    /// @dev A valid plan: three venues at 20% each (under the 30% cap), 20%
    ///      reserve (== floor), 80% total out (== cap). Sums check out.
    function _goodPlan() internal view returns (PlanLib.Plan memory plan) {
        uint256 perVenue = (SEED * 2000) / 1e4; // 20% each
        uint256 reserveAmt = (SEED * 2000) / 1e4; // 20%
        PlanLib.Allocation[] memory allocs = new PlanLib.Allocation[](3);
        allocs[0] = PlanLib.Allocation({venueId: 0, amount: perVenue});
        allocs[1] = PlanLib.Allocation({venueId: 1, amount: perVenue});
        allocs[2] = PlanLib.Allocation({venueId: 2, amount: perVenue});
        plan = PlanLib.Plan({
            planId: keccak256("good-plan-1"),
            modelVersion: MODEL_VERSION,
            codeHash: CODE_HASH,
            nonce: controller.nonce(),
            expiry: block.timestamp + 300,
            totalOut: perVenue * 3 + reserveAmt,
            reserveAmount: reserveAmt,
            allocations: allocs
        });
    }

    // --- the proof ---

    function test_valid_cycle_routes_funds_and_conserves_tvl() public {
        uint256 tvlBefore = vault.totalAssets();
        assertEq(tvlBefore, SEED, "seed TVL");

        PlanLib.Plan memory plan = _goodPlan();
        bytes memory sig = _sign(TEE_PK, plan);

        uint256 nonceBefore = controller.nonce();
        controller.executePlan(plan, sig);

        uint256 perVenue = (SEED * 2000) / 1e4;
        uint256 reserveAmt = (SEED * 2000) / 1e4;

        // Each venue adapter/vault received its amount (1:1 through the mock).
        for (uint256 i = 0; i < 3; i++) {
            assertEq(
                venueAdapters[i].balanceOf(address(vault)),
                perVenue,
                "venue position"
            );
            assertEq(
                mockVaults[i].totalAssets(),
                perVenue,
                "mock vault holds underlying"
            );
        }
        // Reserve got its amount.
        assertEq(
            reserve.balanceOf(address(vault)),
            reserveAmt,
            "reserve position"
        );
        // Idle = TVL - totalOut (20% stayed idle since totalOut == 80%).
        assertEq(
            stable.balanceOf(address(vault)),
            SEED - plan.totalOut,
            "idle remainder"
        );
        // TVL conserved: idle + 3 venues + reserve == SEED.
        assertEq(vault.totalAssets(), tvlBefore, "TVL conserved");
        // nonce incremented.
        assertEq(controller.nonce(), nonceBefore + 1, "nonce++");
    }

    function test_over_venue_cap_reverts() public {
        // One venue at 40% > 30% cap. Reserve 20%, others 20%: totals still add.
        uint256 over = (SEED * 4000) / 1e4; // 40%
        uint256 low = (SEED * 1000) / 1e4; // 10%
        uint256 reserveAmt = (SEED * 2000) / 1e4; // 20%
        PlanLib.Allocation[] memory allocs = new PlanLib.Allocation[](3);
        allocs[0] = PlanLib.Allocation({venueId: 0, amount: over});
        allocs[1] = PlanLib.Allocation({venueId: 1, amount: low});
        allocs[2] = PlanLib.Allocation({venueId: 2, amount: low});
        PlanLib.Plan memory plan = PlanLib.Plan({
            planId: keccak256("bad-plan-overcap"),
            modelVersion: MODEL_VERSION,
            codeHash: CODE_HASH,
            nonce: controller.nonce(),
            expiry: block.timestamp + 300,
            totalOut: over + low + low + reserveAmt,
            reserveAmount: reserveAmt,
            allocations: allocs
        });
        bytes memory sig = _sign(TEE_PK, plan);

        vm.expectRevert(bytes("over venue cap"));
        controller.executePlan(plan, sig);

        // No funds moved: everything still idle in the vault.
        assertEq(stable.balanceOf(address(vault)), SEED, "no funds moved");
    }

    function test_replay_reverts() public {
        PlanLib.Plan memory plan = _goodPlan();
        bytes memory sig = _sign(TEE_PK, plan);

        controller.executePlan(plan, sig);

        // Same planId again -> replay guard trips first.
        vm.expectRevert(bytes("replay"));
        controller.executePlan(plan, sig);
    }
}
