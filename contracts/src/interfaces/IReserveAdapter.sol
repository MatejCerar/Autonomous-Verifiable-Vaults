// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IReserveAdapter {
    function park(uint256 amount) external;

    function withdrawTo(address to, uint256 amount) external;

    function balanceOf(address holder) external view returns (uint256);
}
