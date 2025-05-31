import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { Contract } from "ethers";

/**
 * Deploys the IntentSwap contract using the deployer account and
 * constructor arguments set to the deployer address
 *
 * @param hre HardhatRuntimeEnvironment object.
 */
const deployIntentSwap: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  /*
    On localhost, the deployer account is the one that comes with Hardhat, which is already funded.

    When deploying to live networks (e.g `yarn deploy --network sepolia`), the deployer account
    should have sufficient balance to pay for the gas fees for contract creation.

    You can generate a random account with `yarn generate` which will fill DEPLOYER_PRIVATE_KEY
    with a random private key in the .env file (then used on hardhat.config.ts)
    You can run the `yarn account` command to check your balance in every network.
  */
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // Network-specific router addresses
  const getUniswapRouter = (networkName: string): string => {
    const routers: { [key: string]: string } = {
      // Mainnet
      mainnet: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
      // Testnets
      sepolia: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
      goerli: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
      // Layer 2s
      polygon: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff", // QuickSwap
      arbitrum: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506", // SushiSwap
      optimism: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
      // BSC
      bsc: "0x10ED43C718714eb63d5aA57B78B54704E256024E", // PancakeSwap
      // Local development
      localhost: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
      hardhat: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    };

    return routers[networkName] || routers.mainnet;
  };

  const networkName = hre.network.name;
  const uniswapRouter = getUniswapRouter(networkName);
  const feeRecipient = deployer; // Using deployer as initial fee recipient

  console.log(`Deploying IntentSwap on ${networkName}...`);
  console.log(`Router address: ${uniswapRouter}`);
  console.log(`Fee recipient: ${feeRecipient}`);
  console.log(`Deployer: ${deployer}`);

  await deploy("IntentSwap", {
    from: deployer,
    // Contract constructor arguments
    args: [uniswapRouter, feeRecipient],
    log: true,
    // autoMine: can be passed to the deploy function to make the deployment process faster on local networks by
    // automatically mining the contract deployment transaction. There is no effect on live networks.
    autoMine: true,
  });

  // Get the deployed contract to interact with it after deploying.
  const intentSwap = await hre.ethers.getContract<Contract>("IntentSwap", deployer);
  console.log("👋 IntentSwap deployed to:", await intentSwap.getAddress());

  // Optional: Set up initial configuration
  try {
    console.log("Setting up initial configuration...");

    // Set the deployer as the initial relayer (optional)
    const setRelayerTx = await intentSwap.setRelayer(deployer);
    await setRelayerTx.wait();
    console.log("✅ Relayer set to:", deployer);

    // Authorize the deployer as a fulfiller
    const authorizeFulfillerTx = await intentSwap.setFulfillerAuthorization(deployer, true);
    await authorizeFulfillerTx.wait();
    console.log("✅ Deployer authorized as fulfiller");

    // Get current configuration
    const currentFee = await intentSwap.feeBps();
    const currentFeeRecipient = await intentSwap.feeRecipient();
    const currentRelayer = await intentSwap.relayer();
    const isPaused = await intentSwap.paused();

    console.log("\n📋 Current Contract Configuration:");
    console.log(`Fee (basis points): ${currentFee.toString()} (${(Number(currentFee) / 100).toFixed(2)}%)`);
    console.log(`Fee recipient: ${currentFeeRecipient}`);
    console.log(`Relayer: ${currentRelayer}`);
    console.log(`Paused: ${isPaused}`);
    console.log(`Router: ${uniswapRouter}`);
  } catch (error) {
    console.log("⚠️  Initial configuration failed:", error);
    console.log("Contract deployed successfully but configuration needs to be done manually");
  }

  // Verification info for users
  console.log("\n🚀 Deployment Complete!");
  console.log("\n📝 Next steps:");
  console.log("1. Verify the contract on Etherscan if deploying to a live network");
  console.log("2. Set appropriate relayers and fulfillers using setRelayer() and setFulfillerAuthorization()");
  console.log("3. Configure fee parameters using setFee() and setFeeRecipient() if needed");
  console.log("4. Test the contract with small amounts first");

  if (networkName === "localhost" || networkName === "hardhat") {
    console.log("\n⚠️  Note: You're on a local network. Make sure to:");
    console.log("- Deploy or fork a DEX router for testing");
    console.log("- Have test tokens available for swapping");
  }
};

export default deployIntentSwap;

// Tags are useful if you have multiple deploy files and only want to run one of them.
// e.g. yarn deploy --tags IntentSwap
deployIntentSwap.tags = ["IntentSwap"];
