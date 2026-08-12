// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "../interfaces/IERC20.sol";

/// @title MockLendingVenue
/// @notice A lending venue stand-in with operator-controllable utilisation and
///         liquidity knobs so the demo can force eligibility failures.
contract MockLendingVenue {
    IERC20 public immutable asset;
    address public operator;

    uint256 internal _utilisationBips;
    uint256 internal _availableLiquidity;

    mapping(address => uint256) public suppliedOf;
    uint256 public totalSupplied;

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    constructor(IERC20 _asset) {
        asset = _asset;
        operator = msg.sender;
        _utilisationBips = 4000;
        _availableLiquidity = type(uint256).max / 2;
    }

    function supply(uint256 amount) external {
        require(
            asset.transferFrom(msg.sender, address(this), amount),
            "transfer failed"
        );
        suppliedOf[msg.sender] += amount;
        totalSupplied += amount;
    }

    function withdraw(uint256 amount) external {
        require(amount <= _availableLiquidity, "over available liquidity");
        require(suppliedOf[msg.sender] >= amount, "over supplied");
        suppliedOf[msg.sender] -= amount;
        totalSupplied -= amount;
        require(asset.transfer(msg.sender, amount), "transfer failed");
    }

    function availableLiquidity() external view returns (uint256) {
        return _availableLiquidity;
    }

    function utilisationBips() external view returns (uint256) {
        return _utilisationBips;
    }

    function setUtilisationBips(uint256 bips) external onlyOperator {
        _utilisationBips = bips;
    }

    function setLiquidity(uint256 amount) external onlyOperator {
        _availableLiquidity = amount;
    }
}
