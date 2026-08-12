// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IMandateRegistry} from "./interfaces/IMandateRegistry.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @title MandateRegistry
/// @notice Holds the mandate: the write-once TEE key, enabled version/fingerprint
///         tuples, and the hard limits the controller enforces. Mirrors the real
///         AddTeeVersion / IsCodeHashPlatformSupported shape. Owner = deployer.
contract MandateRegistry is
    IMandateRegistry,
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable
{
    address public teeAddress;
    bool public teeAddressSet;

    struct VersionInfo {
        bool enabled;
        bytes32 codeHash;
        string platform;
    }

    mapping(uint256 => VersionInfo) internal _versions;

    mapping(uint256 => uint256) internal _venueCapBips;
    uint256 internal _maxTotalOutBips;
    uint256 internal _minReserveBips;

    event TeeAddressSet(address indexed tee);
    event VersionAllowed(
        uint256 indexed version,
        bytes32 codeHash,
        string platform
    );
    event VersionRevoked(uint256 indexed version);
    event VenueCapSet(uint256 indexed venueId, uint256 bips);
    event MaxTotalOutSet(uint256 bips);
    event MinReserveSet(uint256 bips);

    modifier onlyRegistryOwner() {
        require(msg.sender == owner(), "not owner");
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(address) internal override onlyRegistryOwner {}

    // --- TEE key binding (write-once, orderbook pattern) ---

    function setTeeAddress(address _tee) external onlyRegistryOwner {
        require(!teeAddressSet, "TEE address already set");
        require(_tee != address(0), "zero address");
        teeAddress = _tee;
        teeAddressSet = true;
        emit TeeAddressSet(_tee);
    }

    // --- version + fingerprint enablement ---

    function allowVersion(
        uint256 _version,
        bytes32 _codeHash,
        string calldata _platform
    ) external onlyRegistryOwner {
        _versions[_version] = VersionInfo({
            enabled: true,
            codeHash: _codeHash,
            platform: _platform
        });
        emit VersionAllowed(_version, _codeHash, _platform);
    }

    function revokeVersion(uint256 _version) external onlyRegistryOwner {
        _versions[_version].enabled = false;
        emit VersionRevoked(_version);
    }

    function isVersionSupported(
        uint256 _version,
        bytes32 _codeHash
    ) external view returns (bool) {
        VersionInfo storage vi = _versions[_version];
        return vi.enabled && vi.codeHash == _codeHash;
    }

    // --- hard limits (the mandate) ---

    function venueCapBips(
        uint256 _venueId
    ) external view returns (uint256) {
        return _venueCapBips[_venueId];
    }

    function maxTotalOutBips() external view returns (uint256) {
        return _maxTotalOutBips;
    }

    function minReserveBips() external view returns (uint256) {
        return _minReserveBips;
    }

    function setVenueCapBips(
        uint256 _venueId,
        uint256 _bips
    ) external onlyRegistryOwner {
        _venueCapBips[_venueId] = _bips;
        emit VenueCapSet(_venueId, _bips);
    }

    function setMaxTotalOutBips(uint256 _bips) external onlyRegistryOwner {
        _maxTotalOutBips = _bips;
        emit MaxTotalOutSet(_bips);
    }

    function setMinReserveBips(uint256 _bips) external onlyRegistryOwner {
        _minReserveBips = _bips;
        emit MinReserveSet(_bips);
    }
}
