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

/// @title RejectUnauthorizedTee
/// @notice SIGNED REJECTION PROOF (in-process twin of scripts/prove-rejection.mjs).
///
///         The product story, made tangible: a plan can be perfectly in-mandate
///         (all three venues under the 30% cap, reserve above the 20% floor,
///         valid nonce, future expiry, carrying the registry's REGISTERED
///         codeHash) and STILL be rejected on-chain, because it was signed by an
///         enclave key that is NOT the one bound in the mandate.
///
///         This is "verify, don't trust": the only thing wrong with the rogue
///         plan is the signing key, so it reverts precisely at check 5,
///         "bad signer" (preimage.md reject order: replay, bad nonce, expired,
///         bad fingerprint, BAD SIGNER, then the cap checks). No funds move.
///
///         The positive control signs the SAME plan bytes with the authorized
///         key and executes it successfully, proving the signer is the one and
///         only difference between accept and reject.
contract RejectUnauthorizedTeeTest is Test {
    // The full testnet stack (same wiring as DeployTestnet.s.sol).
    MockStable internal stable;
    MockERC4626Vault[3] internal mockVaults;
    MysticVenueAdapter[3] internal venueAdapters;
    ReserveAdapter internal reserve;
    MandateRegistry internal registry;
    AutomatedCurationVault internal vault;
    CurationController internal controller;

    // AUTH_PK: the enclave key registered as the mandate's write-once TEE signer.
    uint256 internal constant AUTH_PK = 0xA11CE;
    // ROGUE_PK: a DIFFERENT enclave key, never registered anywhere. This is the
    // wrong enclave: its plans must be rejected even when in-mandate.
    uint256 internal constant ROGUE_PK = 0xB0B;
    address internal authSigner;
    address internal rogueSigner;

    uint256 internal constant MODEL_VERSION = 1;
    bytes32 internal constant CODE_HASH = keccak256("model-module-bytes");

    uint256 internal constant VENUE_CAP_BIPS = 3000; // 30%
    uint256 internal constant MAX_TOTAL_OUT_BIPS = 10000; // 100% (matches DeployTestnet)
    uint256 internal constant MIN_RESERVE_BIPS = 2000; // 20% floor

    address internal depositor = address(0xDEADBEEF);
    uint256 internal constant SEED = 1_000_000 ether;

    function setUp() public {
        authSigner = vm.addr(AUTH_PK);
        rogueSigner = vm.addr(ROGUE_PK);
        // Sanity: the two enclave keys must be distinct for the proof to mean
        // anything.
        assertTrue(authSigner != rogueSigner, "auth != rogue precondition");
        _deployStack();
    }

    /// @dev Rebuilds the DeployTestnet.s.sol stack in-process, registering the
    ///      AUTHORIZED enclave key (vm.addr(AUTH_PK)) as the write-once TEE
    ///      signer. The rogue key is never registered.
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

        // mandate: register the AUTHORIZED TEE key + allowed fingerprint + caps.
        registry.setTeeAddress(authSigner);
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

    /// @dev Signs a plan's domain-separated planHash (preimage.md) with `pk`
    ///      using EIP-191 personal_sign over the raw 32-byte hash.
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

    /// @dev A fully VALID, bounded plan carrying the REGISTERED codeHash: three
    ///      venues at 20% each (< 30% cap), 20% reserve (== floor), 80% total
    ///      out, sums reconcile, valid nonce, future expiry. The ONLY variable
    ///      the caller controls is which key signs it.
    function _goodPlan() internal view returns (PlanLib.Plan memory plan) {
        uint256 perVenue = (SEED * 2000) / 1e4; // 20% each
        uint256 reserveAmt = (SEED * 2000) / 1e4; // 20%
        PlanLib.Allocation[] memory allocs = new PlanLib.Allocation[](3);
        allocs[0] = PlanLib.Allocation({venueId: 0, amount: perVenue});
        allocs[1] = PlanLib.Allocation({venueId: 1, amount: perVenue});
        allocs[2] = PlanLib.Allocation({venueId: 2, amount: perVenue});
        plan = PlanLib.Plan({
            planId: keccak256("rogue-but-in-mandate-plan"),
            modelVersion: MODEL_VERSION,
            codeHash: CODE_HASH, // the REGISTERED fingerprint: check 4 passes
            nonce: controller.nonce(), // valid current nonce: check 2 passes
            expiry: block.timestamp + 300, // future: check 3 passes
            totalOut: perVenue * 3 + reserveAmt,
            reserveAmount: reserveAmt,
            allocations: allocs
        });
    }

    // --- the proof: an in-mandate plan from the WRONG enclave is rejected ---

    function test_rogue_enclave_plan_reverts_bad_signer() public {
        // A perfectly in-mandate plan.
        PlanLib.Plan memory plan = _goodPlan();
        // Signed by the ROGUE enclave key (not the registered TEE signer).
        bytes memory rogueSig = _sign(ROGUE_PK, plan);

        // Confirm the fingerprint the plan carries IS the registered one, so we
        // are proving check 5 (bad signer), not check 4 (bad fingerprint).
        assertTrue(
            registry.isVersionSupported(plan.modelVersion, plan.codeHash),
            "plan carries the registered fingerprint"
        );
        // Confirm the recovered signer is the rogue key, and that it differs
        // from the registered TEE address.
        assertTrue(
            rogueSigner != registry.teeAddress(),
            "rogue signer is not the mandate TEE"
        );

        // Snapshot everything that could move, so we can prove nothing did.
        uint256 idleBefore = stable.balanceOf(address(vault));
        uint256 tvlBefore = vault.totalAssets();
        uint256 nonceBefore = controller.nonce();
        uint256[3] memory venueBefore;
        for (uint256 i = 0; i < 3; i++) {
            venueBefore[i] = venueAdapters[i].balanceOf(address(vault));
        }
        uint256 reserveBefore = reserve.balanceOf(address(vault));

        // The signed rejection: reverts precisely with "bad signer".
        vm.expectRevert(bytes("bad signer"));
        controller.executePlan(plan, rogueSig);

        // NO funds moved.
        assertEq(
            stable.balanceOf(address(vault)),
            idleBefore,
            "vault idle unchanged"
        );
        assertEq(vault.totalAssets(), tvlBefore, "TVL unchanged");
        assertEq(vault.totalAssets(), SEED, "TVL still the full seed");
        for (uint256 i = 0; i < 3; i++) {
            assertEq(
                venueAdapters[i].balanceOf(address(vault)),
                venueBefore[i],
                "venue position unchanged"
            );
            assertEq(venueBefore[i], 0, "venue position was and stays zero");
        }
        assertEq(
            reserve.balanceOf(address(vault)),
            reserveBefore,
            "reserve position unchanged"
        );
        // Nonce unchanged: executePlan reverted, so its nonce++ was rolled back.
        assertEq(controller.nonce(), nonceBefore, "nonce unchanged after revert");
    }

    /// @dev Positive control: the SAME plan bytes, signed by the AUTHORIZED
    ///      enclave key, execute successfully and route funds. This proves the
    ///      signer is the ONLY difference between reject and accept.
    function test_positive_control_same_plan_authorized_signer_executes() public {
        PlanLib.Plan memory plan = _goodPlan();
        bytes memory authSig = _sign(AUTH_PK, plan);

        uint256 perVenue = (SEED * 2000) / 1e4;
        uint256 reserveAmt = (SEED * 2000) / 1e4;
        uint256 nonceBefore = controller.nonce();

        controller.executePlan(plan, authSig);

        // Funds routed exactly as the plan directed.
        for (uint256 i = 0; i < 3; i++) {
            assertEq(
                venueAdapters[i].balanceOf(address(vault)),
                perVenue,
                "venue funded"
            );
        }
        assertEq(
            reserve.balanceOf(address(vault)),
            reserveAmt,
            "reserve funded"
        );
        // TVL conserved, nonce advanced.
        assertEq(vault.totalAssets(), SEED, "TVL conserved");
        assertEq(controller.nonce(), nonceBefore + 1, "nonce++ on success");
    }

    /// @dev Belt-and-suspenders: prove reject then accept in ONE test, on the
    ///      identical plan preimage. The rogue attempt reverts and consumes
    ///      nothing (not even the nonce), so the authorized attempt on the very
    ///      same plan still goes through.
    function test_reject_then_same_plan_accepts() public {
        PlanLib.Plan memory plan = _goodPlan();

        vm.expectRevert(bytes("bad signer"));
        controller.executePlan(plan, _sign(ROGUE_PK, plan));

        // Same plan (same planId, same nonce), now authorized: succeeds.
        controller.executePlan(plan, _sign(AUTH_PK, plan));
        assertEq(vault.totalAssets(), SEED, "TVL conserved after accept");
    }
}
