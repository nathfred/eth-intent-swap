// ES module style import
import pkg from "hardhat";
const { ethers } = pkg;

async function main() {
  // Make sure UNISWAP_V2_ROUTER_ADDRESS is defined in your .env file
  const router = process.env.UNISWAP_V2_ROUTER_ADDRESS;

  if (!router) {
    throw new Error("UNISWAP_V2_ROUTER_ADDRESS not defined in environment variables");
  }

  console.log("Deploying IntentSwap with router address:", router);

  // Get the contract factory
  const IntentSwap = await ethers.getContractFactory("IntentSwap");

  // Deploy the contract
  const intentSwap = await IntentSwap.deploy(router);

  // Wait for the contract to be deployed
  await intentSwap.waitForDeployment();

  // Get the deployed contract address
  const deployedAddress = await intentSwap.getAddress(); // deployed at 0xC0b1aE24aac95aE6084363D7F928Fbde2e82eA31

  console.log("IntentSwap deployed to:", deployedAddress);
}

// Execute main function
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
