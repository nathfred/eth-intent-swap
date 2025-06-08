// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_, uint256 initialSupply) ERC20(name, symbol) {
        _decimals = decimals_;
        _mint(msg.sender, initialSupply * 10 ** decimals_);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    // Mint function for testing (remove in production)
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    // Faucet function for easy testing
    function faucet() external {
        _mint(msg.sender, 1000 * 10 ** _decimals); // Give 1000 tokens
    }
}
