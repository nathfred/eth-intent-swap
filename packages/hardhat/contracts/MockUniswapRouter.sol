// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockUniswapRouter {
    address public tokenA;
    address public tokenB;
    address public wethAddress;

    event SwapExecuted(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);

    constructor(address _tokenA, address _tokenB, address _weth) {
        require(_tokenA != address(0), "Invalid tokenA address");
        require(_tokenB != address(0), "Invalid tokenB address");
        require(_weth != address(0), "Invalid WETH address");

        tokenA = _tokenA;
        tokenB = _tokenB;
        wethAddress = _weth;
    }

    function WETH() external view returns (address) {
        return wethAddress;
    }

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory) {
        require(block.timestamp <= deadline, "Transaction expired");
        require(amountIn > 0, "Amount must be greater than 0");
        require(to != address(0), "Invalid recipient");
        require(path.length >= 2, "Invalid path");

        // Calculate output amount with 10% slippage simulation
        uint256 amountOut = amountIn - (amountIn / 10);
        require(amountOut >= amountOutMin, "Insufficient output amount");

        // Transfer input token from sender
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        // Check if contract has enough output tokens
        require(IERC20(path[1]).balanceOf(address(this)) >= amountOut, "Insufficient liquidity");

        // Transfer output token to recipient
        IERC20(path[1]).transfer(to, amountOut);

        // Return amounts array
        uint[] memory amounts = new uint[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;

        emit SwapExecuted(path[0], path[1], amountIn, amountOut);

        return amounts;
    }

    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory) {
        require(block.timestamp <= deadline, "Transaction expired");
        require(msg.value > 0, "Must send ETH");
        require(to != address(0), "Invalid recipient");
        require(path.length >= 2, "Invalid path");
        require(path[0] == wethAddress, "First token must be WETH");

        // Calculate output amount with 10% slippage simulation
        uint256 amountOut = msg.value - (msg.value / 10);
        require(amountOut >= amountOutMin, "Insufficient output amount");

        // Check if contract has enough output tokens
        require(IERC20(path[1]).balanceOf(address(this)) >= amountOut, "Insufficient liquidity");

        // Transfer output token to recipient
        IERC20(path[1]).transfer(to, amountOut);

        // Return amounts array
        uint[] memory amounts = new uint[](2);
        amounts[0] = msg.value;
        amounts[1] = amountOut;

        emit SwapExecuted(address(0), path[1], msg.value, amountOut);

        return amounts;
    }

    // Function to fund the contract with tokens for testing
    function fundContract(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }

    // Function to withdraw tokens (for testing purposes)
    function withdrawToken(address token, uint256 amount) external {
        IERC20(token).transfer(msg.sender, amount);
    }

    // Function to withdraw ETH (for testing purposes)
    function withdrawETH(uint256 amount) external {
        payable(msg.sender).transfer(amount);
    }

    // Function to check contract's token balance
    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // Function to check contract's ETH balance
    function getETHBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // Receive function to accept ETH
    receive() external payable {}
}
