// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IVenueAdapter {
    function venueId() external view returns (uint256);

    function hardCap() external view returns (uint256);

    function allocate(uint256 amount) external;

    function withdrawTo(address to, uint256 amount) external;

    function balanceOf(address holder) external view returns (uint256);

    function isEligible() external view returns (bool);
}
