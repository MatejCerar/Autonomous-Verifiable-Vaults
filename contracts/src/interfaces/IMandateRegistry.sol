// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IMandateRegistry {
    function teeAddress() external view returns (address);

    function setTeeAddress(address _tee) external;

    function allowVersion(
        uint256 _version,
        bytes32 _codeHash,
        string calldata _platform
    ) external;

    function revokeVersion(uint256 _version) external;

    function isVersionSupported(
        uint256 _version,
        bytes32 _codeHash
    ) external view returns (bool);

    function venueCapBips(uint256 _venueId) external view returns (uint256);

    function maxTotalOutBips() external view returns (uint256);

    function minReserveBips() external view returns (uint256);

    function setVenueCapBips(uint256 _venueId, uint256 _bips) external;

    function setMaxTotalOutBips(uint256 _bips) external;

    function setMinReserveBips(uint256 _bips) external;
}
