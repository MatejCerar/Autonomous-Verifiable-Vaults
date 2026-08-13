// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {MysticVenueAdapter} from "../src/adapters/MysticVenueAdapter.sol";
import {MysticAddresses} from "../src/MysticAddresses.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IERC4626} from "../src/interfaces/IERC4626.sol";

/// @title MysticVenueFork
/// @notice Forks Flare mainnet (chainId 14) and proves the MysticVenueAdapter
///         routes into the LIVE Mystic Core ERC-4626 vaults. Run with:
///           forge test --fork-url https://flare-api.flare.network/ext/C/rpc \
///             --match-contract MysticVenueFork -vvv
///
///         Read-only leg (always): every vault is live, asset() matches the
///         expected token, totalAssets() reads. Deposit leg: for each venue we
///         attempt to fund the adapter (vm.deal for the underlying) and run a
///         real allocate -> vault.deposit, asserting shares > 0 and
///         convertToAssets(shares) ~= amount. If funding a token is impossible
///         (e.g. FXRP uses checkpointed balances that vm.deal cannot forge), the
///         deposit leg is skipped for that token and reported as read-only.
contract MysticVenueForkTest is Test {
    // Only run the body when actually on a Flare fork (chainId 14).
    modifier onlyFlareFork() {
        if (block.chainid != MysticAddresses.FLARE_CHAIN_ID) {
            emit log_string(
                "SKIP: not on a Flare mainnet fork (chainId != 14). Pass --fork-url."
            );
            return;
        }
        _;
    }

    // ---- read-only sanity: all 3 vaults live + asset() matches ----

    function test_fxrpVaultLive() public onlyFlareFork {
        _assertVaultLive(
            MysticAddresses.FXRP_VAULT,
            MysticAddresses.FXRP_TOKEN,
            "FXRP"
        );
    }

    function test_usdt0VaultLive() public onlyFlareFork {
        _assertVaultLive(
            MysticAddresses.USDT0_VAULT,
            MysticAddresses.USDT0_TOKEN,
            "USDT0"
        );
    }

    function test_wflrVaultLive() public onlyFlareFork {
        _assertVaultLive(
            MysticAddresses.WFLR_VAULT,
            MysticAddresses.WFLR_TOKEN,
            "WFLR"
        );
    }

    // ---- deposit legs: real allocate into the live vault ----

    function test_fxrpAdapterDeposit() public onlyFlareFork {
        _runDepositLeg(
            MysticAddresses.FXRP_TOKEN,
            MysticAddresses.FXRP_VAULT,
            0,
            "FXRP"
        );
    }

    function test_usdt0AdapterDeposit() public onlyFlareFork {
        _runDepositLeg(
            MysticAddresses.USDT0_TOKEN,
            MysticAddresses.USDT0_VAULT,
            1,
            "USDT0"
        );
    }

    function test_wflrAdapterDeposit() public onlyFlareFork {
        _runDepositLeg(
            MysticAddresses.WFLR_TOKEN,
            MysticAddresses.WFLR_VAULT,
            2,
            "WFLR"
        );
    }

    // ---- helpers ----

    function _assertVaultLive(
        address vaultAddr,
        address token,
        string memory label
    ) internal {
        // vault must have code
        assertGt(vaultAddr.code.length, 0, string.concat(label, ": vault has no code"));
        IERC4626 v = IERC4626(vaultAddr);
        address got = v.asset();
        assertEq(got, token, string.concat(label, ": vault.asset() mismatch"));
        uint256 ta = v.totalAssets();
        emit log_named_uint(string.concat(label, " totalAssets"), ta);
        emit log_named_address(string.concat(label, " vault.asset()"), got);
    }

    /// @dev Deploys a MysticVenueAdapter, sets this test as its controller,
    ///      tries to fund it with the underlying via vm.deal, then runs a real
    ///      allocate and asserts the shares reflect a live deposit. If funding
    ///      fails (balance did not move, e.g. checkpointed FXRP), we log and
    ///      fall back to read-only for that token instead of failing the run.
    function _runDepositLeg(
        address token,
        address vaultAddr,
        uint256 venueId,
        string memory label
    ) internal {
        // Adapter constructor asserts vault.asset() == token, so this also
        // validates the address pair from MysticAddresses.
        MysticVenueAdapter adapter = new MysticVenueAdapter(
            IERC20(token),
            IERC4626(vaultAddr),
            venueId,
            type(uint256).max
        );
        adapter.setController(address(this));

        // Choose a modest amount scaled to token decimals. Most Flare tokens
        // are 18-decimals (WFLR), USDT0 is 6, FXRP is 6. Read decimals live.
        uint8 dec = _decimals(token);
        uint256 amount = 100 * (10 ** dec);

        // Fund the adapter with REAL, SPENDABLE underlying. vm.deal forges a
        // balance slot that some Flare tokens (checkpointed FXRP/WFLR) do not
        // use for transfers, so a deposit would revert with TransferFromReverted.
        // We layer strategies and verify spendability before committing:
        //   1. WNat wrap: for WFLR, give the adapter native FLR and wrap it.
        //   2. Holder transfer: prank the Mystic vault (a real on-chain holder).
        bool funded = _fund(token, vaultAddr, address(adapter), amount);
        if (!funded) {
            emit log_string(
                string.concat(
                    label,
                    ": deposit leg SKIPPED (could not source real underlying). ",
                    "READ-ONLY VERIFIED ONLY."
                )
            );
            // Still prove the vault is live + asset matches.
            _assertVaultLive(vaultAddr, token, label);
            return;
        }

        uint256 assetsBefore = adapter.balanceOf(address(0));
        // Controller role: this test contract calls allocate (funds already in).
        adapter.allocate(amount);

        uint256 sharesHeld = adapter.shares();
        assertGt(sharesHeld, 0, string.concat(label, ": no shares minted"));

        uint256 assetsAfter = adapter.balanceOf(address(0));
        emit log_named_uint(string.concat(label, " shares"), sharesHeld);
        emit log_named_uint(string.concat(label, " assetsBefore"), assetsBefore);
        emit log_named_uint(string.concat(label, " assetsAfter"), assetsAfter);

        // convertToAssets(shares) should be ~= amount (allow small rounding /
        // any deposit fee: within 1%).
        uint256 lo = amount - (amount / 100);
        assertGe(
            assetsAfter,
            lo,
            string.concat(label, ": convertToAssets below tolerance")
        );
        assertLe(
            assetsAfter,
            amount + (amount / 100),
            string.concat(label, ": convertToAssets above tolerance")
        );

        // Round-trip: reclaim the full position back to this contract.
        uint256 balBefore = IERC20(token).balanceOf(address(this));
        adapter.withdrawTo(address(this), assetsAfter);
        uint256 balAfter = IERC20(token).balanceOf(address(this));
        assertGt(
            balAfter,
            balBefore,
            string.concat(label, ": withdraw returned nothing")
        );
        assertEq(adapter.shares(), 0, string.concat(label, ": shares not zeroed"));
        emit log_named_uint(
            string.concat(label, " reclaimed"),
            balAfter - balBefore
        );
    }

    /// @dev Layered funding: try to give `to` a SPENDABLE `amount` of `token`.
    ///      Returns false if no strategy yields spendable balance, so the caller
    ///      can fall back to read-only.
    function _fund(
        address token,
        address vaultAddr,
        address to,
        uint256 amount
    ) internal returns (bool) {
        // Strategy 1: WNat wrap (WFLR). If the token accepts a native deposit()
        // it is a WNat wrapper; fund `to` with native FLR and wrap on its behalf.
        if (_tryWrapNative(token, to, amount)) {
            return true;
        }
        // Strategy 2: source from a real on-chain holder (the Mystic vault).
        if (_fundFromHolder(token, vaultAddr, to, amount)) {
            return true;
        }
        return false;
    }

    /// @dev If `token` is a WNat-style wrapper, give `to` native FLR and call
    ///      deposit() as `to` to mint spendable wrapped tokens.
    function _tryWrapNative(
        address token,
        address to,
        uint256 amount
    ) internal returns (bool) {
        uint256 before = IERC20(token).balanceOf(to);
        vm.deal(to, amount + 1 ether);
        vm.prank(to);
        (bool ok, ) = token.call{value: amount}(
            abi.encodeWithSignature("deposit()")
        );
        if (!ok) {
            return false;
        }
        return IERC20(token).balanceOf(to) >= before + amount;
    }

    /// @dev Source `amount` of `token` from a live `holder` (a real address that
    ///      already holds a balance on-chain) by pranking a transfer. This works
    ///      for checkpointed tokens where vm.deal cannot forge a spendable slot.
    function _fundFromHolder(
        address token,
        address holder,
        address to,
        uint256 amount
    ) internal returns (bool) {
        if (IERC20(token).balanceOf(holder) < amount) {
            return false;
        }
        uint256 before = IERC20(token).balanceOf(to);
        vm.prank(holder);
        try IERC20(token).transfer(to, amount) returns (bool ok) {
            if (!ok) {
                return false;
            }
        } catch {
            return false;
        }
        return IERC20(token).balanceOf(to) >= before + amount;
    }

    function _decimals(address token) internal view returns (uint8) {
        (bool ok, bytes memory data) = token.staticcall(
            abi.encodeWithSignature("decimals()")
        );
        if (ok && data.length >= 32) {
            return uint8(uint256(bytes32(data)));
        }
        return 18;
    }
}
