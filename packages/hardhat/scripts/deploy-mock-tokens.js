// scripts/deploy-mock-tokens.js
const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying mock tokens...");

  // Deploy Mock USDC
  const MockUSDC = await ethers.getContractFactory("MockToken");
  const usdc = await MockUSDC.deploy(
    "USD Coin",
    "USDC",
    6, // 6 decimals like real USDC
    1000000, // 1M initial supply
  );
  await usdc.waitForDeployment();
  console.log("Mock USDC deployed to:", await usdc.getAddress());

  // Deploy Mock DAI
  const dai = await MockUSDC.deploy(
    "Dai Stablecoin",
    "DAI",
    18, // 18 decimals like real DAI
    1000000, // 1M initial supply
  );
  await dai.waitForDeployment();
  console.log("Mock DAI deployed to:", await dai.getAddress());

  // Deploy Mock WETH
  const weth = await MockUSDC.deploy("Wrapped Ether", "WETH", 18, 1000000);
  await weth.waitForDeployment();
  console.log("Mock WETH deployed to:", await weth.getAddress());

  // Save addresses for frontend
  const addresses = {
    USDC: await usdc.getAddress(),
    DAI: await dai.getAddress(),
    WETH: await weth.getAddress(),
  };

  console.log("\nToken Addresses:", addresses);

  return addresses;
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
