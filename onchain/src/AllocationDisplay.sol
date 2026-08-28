// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title AllocationDisplay
/// @notice Minimal on-chain "display vault" for the AVV TEE demo. It stores the
///         LATEST best position produced by the enclave and a monotonic cycle
///         counter, and emits an event per push. Only the demo relayer
///         (`updater`, set once in the constructor) may write. Reads are open.
///
/// The enclave output is FCC-verified off-chain; this contract simply records
/// the accepted result so the frontend can read it back from chain. On-chain
/// FCC-proof verification is the productionization step (see README).
///
/// No emojis, no em dashes (house style).
contract AllocationDisplay {
    /// @notice One recorded allocation cycle (the current best position).
    /// @dev `amounts` is the fixed 3-venue vector in canonical order
    ///      [0]=FXRP, [1]=USDT0, [2]=WFLR. All USD amounts are 1e18 fixed point.
    struct Cycle {
        bytes32 planId;
        uint256 totalOut;
        uint256 reserveAmount;
        uint256[3] amounts;
        uint64 timestamp;
        uint256 cycleId;
    }

    /// @notice The address allowed to push cycles (the demo relayer).
    address public immutable updater;

    /// @notice Monotonic count of pushed cycles. `latest()` is cycle `cycleCount`.
    uint256 public cycleCount;

    /// @dev The latest stored position.
    Cycle private _latest;

    /// @dev Append-only push history. Read via recentCycles() so the frontend
    ///      never needs eth_getLogs (public Coston2 RPCs cap the block range).
    Cycle[] private _history;

    /// @notice Emitted on every accepted push.
    event CyclePushed(
        uint256 indexed cycleId,
        bytes32 indexed planId,
        uint256 totalOut,
        uint256 reserveAmount,
        uint256[3] amounts,
        uint64 timestamp
    );

    error NotUpdater();

    constructor(address _updater) {
        require(_updater != address(0), "updater=0");
        updater = _updater;
    }

    modifier onlyUpdater() {
        if (msg.sender != updater) revert NotUpdater();
        _;
    }

    /// @notice Record a new best position. Increments `cycleCount`, stores it as
    ///         the latest, and emits `CyclePushed`.
    /// @param planId        The enclave PlanLib.Plan planId.
    /// @param totalOut      Total capital pulled this cycle (USD 1e18).
    /// @param reserveAmount Reserve residual (USD 1e18).
    /// @param amounts       Per-venue amounts [FXRP, USDT0, WFLR] (USD 1e18).
    function pushCycle(
        bytes32 planId,
        uint256 totalOut,
        uint256 reserveAmount,
        uint256[3] calldata amounts
    ) external onlyUpdater returns (uint256 cycleId) {
        cycleId = ++cycleCount;
        uint64 ts = uint64(block.timestamp);

        _latest = Cycle({
            planId: planId,
            totalOut: totalOut,
            reserveAmount: reserveAmount,
            amounts: amounts,
            timestamp: ts,
            cycleId: cycleId
        });
        _history.push(_latest);

        emit CyclePushed(
            cycleId,
            planId,
            totalOut,
            reserveAmount,
            amounts,
            ts
        );
    }

    /// @notice The latest recorded position. Reverts-free: returns a zeroed
    ///         Cycle (cycleId 0) before the first push.
    function latest() external view returns (Cycle memory) {
        return _latest;
    }

    /// @notice Total number of recorded cycles.
    function historyLength() external view returns (uint256) {
        return _history.length;
    }

    /// @notice The most recent `n` cycles, newest first (capped at history length).
    function recentCycles(uint256 n) external view returns (Cycle[] memory out) {
        uint256 len = _history.length;
        if (n > len) n = len;
        out = new Cycle[](n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = _history[len - 1 - i];
        }
    }
}
