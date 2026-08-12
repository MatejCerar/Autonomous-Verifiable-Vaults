// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IVault {
    function asset() external view returns (address);

    function totalAssets() external view returns (uint256);

    function pullForCuration(uint256 amount) external returns (uint256);

    function reconcile() external;

    function setController(address c) external;
}
