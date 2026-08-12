// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "./interfaces/IERC20.sol";
import {IVenueAdapter} from "./interfaces/IVenueAdapter.sol";
import {IReserveAdapter} from "./interfaces/IReserveAdapter.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @title AutomatedCurationVault
/// @notice Minimal ERC-4626-ish vault over MockStable. Idle assets can be pulled
///         by the controller for curation; totalAssets() sums idle balance plus
///         positions custodied in the venue adapters and the reserve adapter.
contract AutomatedCurationVault is
    IERC20,
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable
{
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    IERC20 public asset;
    address public controller;

    address[] public venueAdapters;
    address public reserveAdapter;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Deposit(
        address indexed caller,
        address indexed receiver,
        uint256 assets,
        uint256 shares
    );
    event Withdraw(
        address indexed caller,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );
    event PulledForCuration(uint256 amount);
    event Reconciled(uint256 totalAssets);

    modifier onlyVaultOwner() {
        require(msg.sender == owner(), "not owner");
        _;
    }

    modifier onlyController() {
        require(msg.sender == controller, "not controller");
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(IERC20 _asset) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        name = "Automated Curation Vault";
        symbol = "acVAULT";
        asset = _asset;
    }

    function _authorizeUpgrade(address) internal override onlyVaultOwner {}

    // --- one-time wiring ---

    function setController(address c) external onlyVaultOwner {
        require(controller == address(0), "controller set");
        controller = c;
    }

    function setAdapters(
        address[] calldata _venueAdapters,
        address _reserveAdapter
    ) external onlyVaultOwner {
        require(reserveAdapter == address(0), "adapters set");
        for (uint256 i = 0; i < _venueAdapters.length; i++) {
            venueAdapters.push(_venueAdapters[i]);
        }
        reserveAdapter = _reserveAdapter;
    }

    function venueAdapterCount() external view returns (uint256) {
        return venueAdapters.length;
    }

    // --- NAV ---

    /// @notice idle + sum(venue adapter positions) + reserve position.
    function totalAssets() public view returns (uint256) {
        uint256 total = asset.balanceOf(address(this));
        for (uint256 i = 0; i < venueAdapters.length; i++) {
            total += IVenueAdapter(venueAdapters[i]).balanceOf(address(this));
        }
        if (reserveAdapter != address(0)) {
            total += IReserveAdapter(reserveAdapter).balanceOf(address(this));
        }
        return total;
    }

    function convertToShares(
        uint256 assets
    ) public view returns (uint256) {
        uint256 supply = totalSupply;
        uint256 ta = totalAssets();
        if (supply == 0 || ta == 0) {
            return assets;
        }
        return (assets * supply) / ta;
    }

    function convertToAssets(
        uint256 shares
    ) public view returns (uint256) {
        uint256 supply = totalSupply;
        if (supply == 0) {
            return shares;
        }
        return (shares * totalAssets()) / supply;
    }

    // --- ERC4626-ish user surface ---

    function deposit(
        uint256 assets,
        address receiver
    ) external returns (uint256 shares) {
        shares = convertToShares(assets);
        require(shares > 0, "zero shares");
        require(
            asset.transferFrom(msg.sender, address(this), assets),
            "transfer failed"
        );
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address ownerAddr
    ) external returns (uint256 shares) {
        shares = convertToShares(assets);
        require(shares > 0, "zero shares");
        if (msg.sender != ownerAddr) {
            uint256 allowed = allowance[ownerAddr][msg.sender];
            if (allowed != type(uint256).max) {
                require(allowed >= shares, "insufficient allowance");
                allowance[ownerAddr][msg.sender] = allowed - shares;
            }
        }
        require(
            asset.balanceOf(address(this)) >= assets,
            "insufficient idle"
        );
        _burn(ownerAddr, shares);
        require(asset.transfer(receiver, assets), "transfer failed");
        emit Withdraw(msg.sender, receiver, ownerAddr, assets, shares);
    }

    // --- curation surface (controller only) ---

    /// @notice Transfer `amount` idle asset to the controller, which forwards it
    ///         to the venue/reserve adapters within the same tx.
    function pullForCuration(
        uint256 amount
    ) external onlyController returns (uint256) {
        require(
            asset.balanceOf(address(this)) >= amount,
            "insufficient idle"
        );
        require(asset.transfer(controller, amount), "transfer failed");
        emit PulledForCuration(amount);
        return amount;
    }

    /// @notice Recompute NAV from adapters + idle. No-op on state; emits event.
    function reconcile() external onlyController {
        emit Reconciled(totalAssets());
    }

    // --- internal ERC20 ---

    function _mint(address to, uint256 shares) internal {
        totalSupply += shares;
        balanceOf[to] += shares;
        emit Transfer(address(0), to, shares);
    }

    function _burn(address from, uint256 shares) internal {
        require(balanceOf[from] >= shares, "insufficient shares");
        balanceOf[from] -= shares;
        totalSupply -= shares;
        emit Transfer(from, address(0), shares);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "insufficient allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "insufficient shares");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
