const { ethers } = require("ethers");
const hre = require("hardhat");

require("dotenv").config();

async function main() {
  const provider = new ethers.JsonRpcProvider("http://localhost:8545");
  const relayer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const intentSwap = await hre.ethers.getContractAt(
    "IntentSwap",
    "0xYourDeployedContractAddress",
    relayer
  );

  const intent = {
    fromToken: "0xYourTokenA", // Use address from deploy-mocks
    toToken: "0xYourTokenB",
    amountIn: ethers.parseEther("100"),
    minAmountOut: ethers.parseEther("90"),
    recipient: relayer.address, // Or another address you're testing
    deadline: Math.floor(Date.now() / 1000) + 600,
    nonce: 0,
  };

  const signature = "0xSignedTypedDataFromFrontend";

  const tx = await intentSwap.executeSwap(intent, signature);
  const receipt = await tx.wait();
  console.log("Swap Executed in Tx:", receipt.transactionHash);
}

main().catch(console.error);
