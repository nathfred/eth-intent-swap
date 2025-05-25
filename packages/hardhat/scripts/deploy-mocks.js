import { ethers, network } from "hardhat";

async function main() {
  try {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);
    console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

    // Deploy TokenA
    console.log("\nDeploying TokenA...");
    const TokenA = await ethers.getContractFactory("MockERC20");
    const tokenA = await TokenA.deploy("TokenA", "TKA", ethers.parseEther("1000000"));
    await tokenA.waitForDeployment();

    const tokenAAddress = await tokenA.getAddress();
    console.log("TokenA deployed to:", tokenAAddress);

    // Deploy TokenB
    console.log("\nDeploying TokenB...");
    const TokenB = await ethers.getContractFactory("MockERC20");
    const tokenB = await TokenB.deploy("TokenB", "TKB", ethers.parseEther("1000000"));
    await tokenB.waitForDeployment();

    const tokenBAddress = await tokenB.getAddress();
    console.log("TokenB deployed to:", tokenBAddress);

    // Deploy Mock WETH (useful for testing)
    console.log("\nDeploying Mock WETH...");
    const MockWETH = await ethers.getContractFactory("MockERC20");
    const mockWETH = await MockWETH.deploy("Wrapped Ether", "WETH", ethers.parseEther("1000000"));
    await mockWETH.waitForDeployment();

    const mockWETHAddress = await mockWETH.getAddress();
    console.log("Mock WETH deployed to:", mockWETHAddress);

    // Deploy MockUniswapRouter
    console.log("\nDeploying MockUniswapRouter...");
    const MockRouter = await ethers.getContractFactory("MockUniswapRouter");
    const router = await MockRouter.deploy(tokenAAddress, tokenBAddress, mockWETHAddress);
    await router.waitForDeployment();

    const routerAddress = await router.getAddress();
    console.log("MockUniswapRouter deployed to:", routerAddress);

    // Deploy IntentSwap contract
    console.log("\nDeploying IntentSwap...");
    const IntentSwap = await ethers.getContractFactory("IntentSwap");
    const intentSwap = await IntentSwap.deploy(routerAddress);
    await intentSwap.waitForDeployment();

    const intentSwapAddress = await intentSwap.getAddress();
    console.log("IntentSwap deployed to:", intentSwapAddress);

    // Fund the router with tokens for testing
    console.log("\nFunding router with tokens...");
    const fundAmount = ethers.parseEther("100000");

    await tokenA.transfer(routerAddress, fundAmount);
    await tokenB.transfer(routerAddress, fundAmount);

    console.log("Router funded with", ethers.formatEther(fundAmount), "of each token");

    // Verify deployments
    console.log("\n=== Deployment Summary ===");
    console.log("Network:", network.name);
    console.log("Deployer:", deployer.address);
    console.log("TokenA:", tokenAAddress);
    console.log("TokenB:", tokenBAddress);
    console.log("Mock WETH:", mockWETHAddress);
    console.log("MockUniswapRouter:", routerAddress);
    console.log("IntentSwap:", intentSwapAddress);

    // Verify token balances
    console.log("\n=== Token Balances ===");
    console.log("Deployer TokenA balance:", ethers.formatEther(await tokenA.balanceOf(deployer.address)));
    console.log("Deployer TokenB balance:", ethers.formatEther(await tokenB.balanceOf(deployer.address)));
    console.log("Router TokenA balance:", ethers.formatEther(await tokenA.balanceOf(routerAddress)));
    console.log("Router TokenB balance:", ethers.formatEther(await tokenB.balanceOf(routerAddress)));

    // Test basic functionality
    console.log("\n=== Basic Functionality Tests ===");

    // Test token details
    console.log("TokenA name:", await tokenA.name());
    console.log("TokenA symbol:", await tokenA.symbol());
    console.log("TokenA decimals:", await tokenA.decimals());
    console.log("TokenA total supply:", ethers.formatEther(await tokenA.totalSupply()));

    // Test router WETH function
    const wethFromRouter = await router.WETH();
    console.log("Router WETH address:", wethFromRouter);
    console.log("WETH matches mock WETH:", wethFromRouter === mockWETHAddress);

    // Test IntentSwap router address
    const routerFromIntentSwap = await intentSwap.uniswapRouter();
    console.log("IntentSwap router address:", routerFromIntentSwap);
    console.log("Router address matches:", routerFromIntentSwap === routerAddress);

    console.log("\n✅ All contracts deployed and tested successfully!");
  } catch (error) {
    console.error("❌ Deployment failed:", error);
    throw error;
  }
}

// Execute main function with proper error handling
main()
  .then(() => {
    console.log("\n🎉 Script completed successfully!");
    process.exit(0);
  })
  .catch(error => {
    console.error("\n💥 Script failed with error:", error);
    process.exitCode = 1;
  });
