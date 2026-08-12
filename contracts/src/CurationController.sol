// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {PlanLib} from "./libraries/PlanLib.sol";
import {IMandateRegistry} from "./interfaces/IMandateRegistry.sol";
import {IVenueAdapter} from "./interfaces/IVenueAdapter.sol";
import {IReserveAdapter} from "./interfaces/IReserveAdapter.sol";
import {IVault} from "./interfaces/IVault.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @title CurationController
/// @notice The enforcement + plan verifier. Copies the fce-orderbook verify
///         discipline (EIP-191 recover to a write-once TEE key) and adds mandate
///         enforcement + capped execution. Pure enforcement + custody routing;
///         it does NOT read FTSO (that is off-chain, in the model service).
contract CurationController is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable
{
    using PlanLib for PlanLib.Plan;

    IVault public vault;
    IMandateRegistry public registry;
    IERC20 public asset;
    IReserveAdapter public reserveAdapter;

    address[] public adaptersList;

    mapping(bytes32 => bool) public usedPlanIds;
    uint256 public nonce;

    event PlanExecuted(
        bytes32 indexed planId,
        uint256 totalOut,
        uint256 reserveAmount
    );
    event Allocated(
        bytes32 indexed planId,
        uint256 indexed venueId,
        uint256 amount
    );
    event Reserved(bytes32 indexed planId, uint256 amount);

    constructor() {
        _disableInitializers();
    }

    function initialize(
        IVault _vault,
        IMandateRegistry _registry,
        IERC20 _asset,
        IReserveAdapter _reserveAdapter,
        address[] memory _adapters
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        vault = _vault;
        registry = _registry;
        asset = _asset;
        reserveAdapter = _reserveAdapter;
        for (uint256 i = 0; i < _adapters.length; i++) {
            adaptersList.push(_adapters[i]);
        }
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function adapters(uint256 venueId) external view returns (address) {
        return adaptersList[venueId];
    }

    function adapterCount() external view returns (uint256) {
        return adaptersList.length;
    }

    /// @notice The single entry point the relayer calls with the signed plan.
    ///         Runs the 8 ordered checks (preimage.md), reverting before any
    ///         adapter.allocate so no funds move on a bad plan.
    function executePlan(
        PlanLib.Plan calldata plan,
        bytes calldata signature
    ) external {
        // 1. replay
        require(!usedPlanIds[plan.planId], "replay");
        usedPlanIds[plan.planId] = true;

        // 2. bad nonce
        require(plan.nonce == nonce, "bad nonce");
        nonce++;

        // 3. expired
        require(block.timestamp <= plan.expiry, "expired");

        // 4. bad fingerprint
        require(
            registry.isVersionSupported(plan.modelVersion, plan.codeHash),
            "bad fingerprint"
        );

        // 5. bad signer
        {
            bytes32 planHash = PlanLib.hashPlan(
                address(this),
                block.chainid,
                plan
            );
            address signer = PlanLib.recoverSigner(planHash, signature);
            require(signer == registry.teeAddress(), "bad signer");
        }

        // 6. mandate limits against live vault TVL
        IMandateRegistry _registry = registry;
        uint256 tvl = vault.totalAssets();
        require(
            plan.reserveAmount >= (tvl * _registry.minReserveBips()) / 1e4,
            "reserve floor"
        );
        require(
            plan.totalOut <= (tvl * _registry.maxTotalOutBips()) / 1e4,
            "over total cap"
        );
        uint256 sumAlloc = 0;
        for (uint256 i = 0; i < plan.allocations.length; i++) {
            PlanLib.Allocation calldata a = plan.allocations[i];
            _checkVenueCap(_registry, tvl, a.venueId, a.amount);
            sumAlloc += a.amount;
        }
        require(
            sumAlloc + plan.reserveAmount == plan.totalOut,
            "totals mismatch"
        );

        // 7. rebalance: reclaim everything currently deployed back to the vault
        //    first, so each cycle starts from a clean idle balance. This makes a
        //    cycle an idempotent full rebalance (not an additive deploy), so the
        //    same plan can run every cycle without depleting idle liquidity.
        for (uint256 i = 0; i < adaptersList.length; i++) {
            uint256 bal = IVenueAdapter(adaptersList[i]).balanceOf(address(vault));
            if (bal > 0) {
                IVenueAdapter(adaptersList[i]).withdrawTo(address(vault), bal);
            }
        }
        {
            uint256 parked = reserveAdapter.balanceOf(address(vault));
            if (parked > 0) {
                reserveAdapter.withdrawTo(address(vault), parked);
            }
        }

        // 7b. execute: pull then forward
        vault.pullForCuration(plan.totalOut);

        for (uint256 i = 0; i < plan.allocations.length; i++) {
            PlanLib.Allocation calldata a = plan.allocations[i];
            _forwardAllocation(plan.planId, a.venueId, a.amount);
        }

        if (plan.reserveAmount > 0) {
            require(
                asset.transfer(
                    address(reserveAdapter),
                    plan.reserveAmount
                ),
                "reserve transfer failed"
            );
        }
        reserveAdapter.park(plan.reserveAmount);
        emit Reserved(plan.planId, plan.reserveAmount);

        // 8. reconcile + emit
        vault.reconcile();
        emit PlanExecuted(plan.planId, plan.totalOut, plan.reserveAmount);
    }

    /// @dev Forwards one allocation to its venue adapter. Extracted from
    ///      executePlan to keep the address-heavy body off the main stack
    ///      frame (via-ir depth). Behavior is identical to the inline loop.
    function _forwardAllocation(
        bytes32 planId,
        uint256 venueId,
        uint256 amount
    ) private {
        address adapter = adaptersList[venueId];
        require(
            asset.transfer(adapter, amount),
            "adapter transfer failed"
        );
        IVenueAdapter(adapter).allocate(amount);
        emit Allocated(planId, venueId, amount);
    }

    /// @dev Enforces the per-venue cap. Extracted from executePlan so the
    ///      cap arithmetic stays off the main stack frame (via-ir depth).
    function _checkVenueCap(
        IMandateRegistry _registry,
        uint256 tvl,
        uint256 venueId,
        uint256 amount
    ) private view {
        require(
            amount <= (tvl * _registry.venueCapBips(venueId)) / 1e4,
            "over venue cap"
        );
    }
}
