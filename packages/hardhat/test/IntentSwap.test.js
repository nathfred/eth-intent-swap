import { expect } from "chai";
import { ethers } from "hardhat";

describe("IntentSwap", function () {
  let owner, user, relayer;
  let intentSwap, tokenA, tokenB, router, mockWETH;
  const initialSupply = ethers.parseEther("1000000");

  beforeEach(async function () {
    [owner, user, relayer] = await ethers.getSigners();

    // Deploy Mock ERC20 tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");

    tokenA = await MockERC20.deploy("TokenA", "TKA", initialSupply);
    await tokenA.waitForDeployment();

    tokenB = await MockERC20.deploy("TokenB", "TKB", initialSupply);
    await tokenB.waitForDeployment();

    // Deploy Mock WETH token
    mockWETH = await MockERC20.deploy("Wrapped Ether", "WETH", initialSupply);
    await mockWETH.waitForDeployment();

    // Deploy MockUniswapRouter with WETH address
    const MockRouter = await ethers.getContractFactory("MockUniswapRouter");
    router = await MockRouter.deploy(tokenA.target, tokenB.target, mockWETH.target);
    await router.waitForDeployment();

    // Fund the router with tokenB for swaps
    await tokenB.transfer(router.target, ethers.parseEther("100000"));

    // Deploy IntentSwap contract
    const IntentSwap = await ethers.getContractFactory("IntentSwap");
    intentSwap = await IntentSwap.deploy(router.target);
    await intentSwap.waitForDeployment();

    // Transfer tokens to user
    await tokenA.transfer(user.address, ethers.parseEther("1000"));
    await tokenB.transfer(user.address, ethers.parseEther("1000"));
  });

  it("should execute token-to-token swap using signed intent", async function () {
    const amountIn = ethers.parseEther("100");
    const minAmountOut = ethers.parseEther("90");
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const nonce = 0;

    // User approves tokenA to the IntentSwap contract
    await tokenA.connect(user).approve(intentSwap.target, amountIn);

    // Check initial balances
    const initialTokenABalance = await tokenA.balanceOf(user.address);
    const initialTokenBBalance = await tokenB.balanceOf(user.address);

    console.log("Initial TokenA balance:", ethers.formatEther(initialTokenABalance));
    console.log("Initial TokenB balance:", ethers.formatEther(initialTokenBBalance));

    const intent = {
      fromToken: tokenA.target,
      toToken: tokenB.target,
      amountIn,
      minAmountOut,
      recipient: user.address,
      deadline,
      nonce,
    };

    // Build EIP-712 signature
    const domain = {
      name: "IntentSwap",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: intentSwap.target,
    };

    const types = {
      SwapIntent: [
        { name: "fromToken", type: "address" },
        { name: "toToken", type: "address" },
        { name: "amountIn", type: "uint256" },
        { name: "minAmountOut", type: "uint256" },
        { name: "recipient", type: "address" },
        { name: "deadline", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    };

    const signature = await user.signTypedData(domain, types, intent);

    // Execute swap via relayer
    const tx = await intentSwap.connect(relayer).executeSwap(intent, signature);
    await tx.wait();

    // Check final balances
    const finalTokenABalance = await tokenA.balanceOf(user.address);
    const finalTokenBBalance = await tokenB.balanceOf(user.address);

    console.log("Final TokenA balance:", ethers.formatEther(finalTokenABalance));
    console.log("Final TokenB balance:", ethers.formatEther(finalTokenBBalance));

    // Verify tokenA was deducted
    expect(finalTokenABalance).to.equal(initialTokenABalance - amountIn);

    // Verify tokenB was received (90% of input due to 10% slippage in mock)
    const expectedTokenBReceived = amountIn - amountIn / 10n;
    expect(finalTokenBBalance).to.equal(initialTokenBBalance + expectedTokenBReceived);

    // Verify nonce was incremented
    const newNonce = await intentSwap.nonces(user.address);
    expect(newNonce).to.equal(1);
  });

  it("should execute ETH-to-token swap using signed intent", async function () {
    const amountIn = ethers.parseEther("1");
    const minAmountOut = ethers.parseEther("0.9");
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const nonce = 0;

    // Check initial balances
    // const initialETHBalance = await ethers.provider.getBalance(user.address);
    const initialTokenBBalance = await tokenB.balanceOf(user.address);

    const intent = {
      fromToken: ethers.ZeroAddress, // ETH represented as zero address
      toToken: tokenB.target,
      amountIn,
      minAmountOut,
      recipient: user.address,
      deadline,
      nonce,
    };

    // Build EIP-712 signature
    const domain = {
      name: "IntentSwap",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: intentSwap.target,
    };

    const types = {
      SwapIntent: [
        { name: "fromToken", type: "address" },
        { name: "toToken", type: "address" },
        { name: "amountIn", type: "uint256" },
        { name: "minAmountOut", type: "uint256" },
        { name: "recipient", type: "address" },
        { name: "deadline", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    };

    const signature = await user.signTypedData(domain, types, intent);

    // Execute swap with ETH value
    const tx = await intentSwap.connect(relayer).executeSwap(intent, signature, {
      value: amountIn,
    });
    await tx.wait();

    // Check final balances
    const finalTokenBBalance = await tokenB.balanceOf(user.address);

    // Verify tokenB was received (90% of input due to 10% slippage in mock)
    const expectedTokenBReceived = amountIn - amountIn / 10n;
    expect(finalTokenBBalance).to.equal(initialTokenBBalance + expectedTokenBReceived);

    // Verify nonce was incremented
    const newNonce = await intentSwap.nonces(user.address);
    expect(newNonce).to.equal(1);
  });

  it("should reject swap with invalid signature", async function () {
    const amountIn = ethers.parseEther("100");
    const minAmountOut = ethers.parseEther("90");
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const nonce = 0;

    const intent = {
      fromToken: tokenA.target,
      toToken: tokenB.target,
      amountIn,
      minAmountOut,
      recipient: user.address,
      deadline,
      nonce,
    };

    // Create signature with wrong signer (owner instead of user)
    const domain = {
      name: "IntentSwap",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: intentSwap.target,
    };

    const types = {
      SwapIntent: [
        { name: "fromToken", type: "address" },
        { name: "toToken", type: "address" },
        { name: "amountIn", type: "uint256" },
        { name: "minAmountOut", type: "uint256" },
        { name: "recipient", type: "address" },
        { name: "deadline", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    };

    const invalidSignature = await owner.signTypedData(domain, types, intent);

    // Should revert with invalid signer
    await expect(intentSwap.connect(relayer).executeSwap(intent, invalidSignature)).to.be.revertedWith(
      "Invalid signer",
    );
  });

  it("should reject expired intent", async function () {
    const amountIn = ethers.parseEther("100");
    const minAmountOut = ethers.parseEther("90");
    const deadline = Math.floor(Date.now() / 1000) - 3600; // Past deadline
    const nonce = 0;

    const intent = {
      fromToken: tokenA.target,
      toToken: tokenB.target,
      amountIn,
      minAmountOut,
      recipient: user.address,
      deadline,
      nonce,
    };

    const domain = {
      name: "IntentSwap",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: intentSwap.target,
    };

    const types = {
      SwapIntent: [
        { name: "fromToken", type: "address" },
        { name: "toToken", type: "address" },
        { name: "amountIn", type: "uint256" },
        { name: "minAmountOut", type: "uint256" },
        { name: "recipient", type: "address" },
        { name: "deadline", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    };

    const signature = await user.signTypedData(domain, types, intent);

    // Should revert with expired intent
    await expect(intentSwap.connect(relayer).executeSwap(intent, signature)).to.be.revertedWith("Intent expired");
  });
});
