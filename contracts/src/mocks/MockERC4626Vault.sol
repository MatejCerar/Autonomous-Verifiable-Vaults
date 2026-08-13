// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "../interfaces/IERC20.sol";
import {IERC4626} from "../interfaces/IERC4626.sol";

/// @title MockERC4626Vault
/// @notice Minimal, correct ERC-4626 tokenized vault over a supplied ERC-20.
///         Stands in for a live Mystic Core ERC-4626 market on testnets where
///         Mystic is not deployed (Coston2). It implements exactly the surface
///         the MysticVenueAdapter consumes via IERC4626 (asset, totalAssets,
///         deposit, mint, withdraw, redeem, convertToAssets, convertToShares,
///         balanceOf, decimals) plus the standard share-token accounting.
///
/// @dev Accounting is a share/asset ratio driven purely by held underlying:
///        - first deposit mints shares 1:1 with assets (initial price = 1.0),
///        - subsequent conversions use totalSupply / totalAssets, so if the
///          vault ever receives extra underlying (a simulated yield transfer)
///          existing shares appreciate, exactly like a real ERC-4626.
///      This is a faithful minimal ERC-4626, not a fee-taking market; that is
///      the intended simplification for a testnet stand-in.
contract MockERC4626Vault is IERC4626 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    IERC20 public immutable underlying;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Deposit(
        address indexed caller,
        address indexed owner,
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
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(
        address indexed owner,
        address indexed spender,
        uint256 value
    );

    /// @param _underlying The ERC-20 this vault holds and denominates in.
    /// @param _name       Share-token name (e.g. "Mystic Core FXRP (mock)").
    /// @param _symbol     Share-token symbol.
    constructor(IERC20 _underlying, string memory _name, string memory _symbol) {
        underlying = _underlying;
        name = _name;
        symbol = _symbol;
    }

    // --- ERC4626 metadata ---

    function asset() external view returns (address) {
        return address(underlying);
    }

    /// @notice All underlying currently held by this vault.
    function totalAssets() public view returns (uint256) {
        return underlying.balanceOf(address(this));
    }

    // --- conversions ---

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply;
        uint256 ta = totalAssets();
        if (supply == 0 || ta == 0) {
            return assets;
        }
        return (assets * supply) / ta;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply;
        if (supply == 0) {
            return shares;
        }
        return (shares * totalAssets()) / supply;
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return convertToShares(assets);
    }

    function previewMint(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply;
        uint256 ta = totalAssets();
        if (supply == 0 || ta == 0) {
            return shares;
        }
        // Round up so minting `shares` always pulls enough assets.
        return (shares * ta + supply - 1) / supply;
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply;
        uint256 ta = totalAssets();
        if (supply == 0 || ta == 0) {
            return assets;
        }
        // Round up so withdrawing `assets` always burns enough shares.
        return (assets * supply + ta - 1) / ta;
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    // --- deposit / mint ---

    /// @notice Deposit `assets`, minting shares to `receiver`. Assets are pulled
    ///         from msg.sender via transferFrom (adapter approves first).
    function deposit(
        uint256 assets,
        address receiver
    ) external returns (uint256 shares) {
        shares = convertToShares(assets);
        require(shares > 0, "zero shares");
        require(
            underlying.transferFrom(msg.sender, address(this), assets),
            "transfer failed"
        );
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /// @notice Mint exactly `shares` to `receiver`, pulling the required assets.
    function mint(
        uint256 shares,
        address receiver
    ) external returns (uint256 assets) {
        assets = previewMint(shares);
        require(
            underlying.transferFrom(msg.sender, address(this), assets),
            "transfer failed"
        );
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    // --- withdraw / redeem ---

    /// @notice Withdraw exactly `assets` to `receiver`, burning owner's shares.
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) external returns (uint256 shares) {
        shares = previewWithdraw(assets);
        _spendAllowance(owner, shares);
        _burn(owner, shares);
        require(underlying.transfer(receiver, assets), "transfer failed");
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    /// @notice Redeem `shares` from `owner`, sending the underlying to `receiver`.
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external returns (uint256 assets) {
        assets = convertToAssets(shares);
        require(assets > 0, "zero assets");
        _spendAllowance(owner, shares);
        _burn(owner, shares);
        require(underlying.transfer(receiver, assets), "transfer failed");
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    // --- ERC20 share token ---

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
        _spendAllowance(from, amount);
        _transfer(from, to, amount);
        return true;
    }

    // --- internals ---

    function _spendAllowance(address owner, uint256 amount) internal {
        if (owner == msg.sender) {
            return;
        }
        uint256 allowed = allowance[owner][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "insufficient allowance");
            allowance[owner][msg.sender] = allowed - amount;
        }
    }

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

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "insufficient shares");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
