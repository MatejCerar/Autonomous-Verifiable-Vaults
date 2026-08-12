// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title PlanLib
/// @notice Plan/Allocation structs and the authoritative signed-hash preimage.
///         Byte-for-byte identical to demo/schema/preimage.md. Any change here
///         requires updating the off-chain signer to match.
library PlanLib {
    struct Allocation {
        uint256 venueId;
        uint256 amount;
    }

    struct Plan {
        bytes32 planId;
        uint256 modelVersion;
        bytes32 codeHash;
        uint256 nonce;
        uint256 expiry;
        uint256 totalOut;
        uint256 reserveAmount;
        Allocation[] allocations;
    }

    /// @notice Domain-separated plan hash. `controller` and `chainId` are the
    ///         intentional hardening over the bare orderbook preimage.
    function hashPlan(
        address controller,
        uint256 chainId,
        Plan calldata plan
    ) internal pure returns (bytes32) {
        bytes32 allocHash = keccak256(abi.encode(plan.allocations));
        return
            keccak256(
                abi.encodePacked(
                    controller,
                    chainId,
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

    /// @notice EIP-191 personal_sign digest over the raw 32-byte planHash.
    function ethHash(bytes32 planHash) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    "\x19Ethereum Signed Message:\n32",
                    planHash
                )
            );
    }

    /// @notice Recover the signer of a planHash from a 65-byte signature.
    function recoverSigner(
        bytes32 planHash,
        bytes memory signature
    ) internal pure returns (address) {
        require(signature.length == 65, "bad sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (v < 27) {
            v += 27;
        }
        require(v == 27 || v == 28, "bad sig v");
        return ecrecover(ethHash(planHash), v, r, s);
    }
}
