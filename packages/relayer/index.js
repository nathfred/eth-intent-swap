// packages/relayer/index.js
require("dotenv").config();
const { ethers } = require("ethers");
const contractABI = require("./IntentSwap.json"); // ABI from your contract

const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

const main = async () => {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, wallet);

  // Example payload (should come from frontend/API/queue in real usage)
  const intent = {
    fromToken: ethers.constants.AddressZero,
    toToken: process.env.USDC_ADDRESS,
    amountIn: ethers.utils.parseEther("0.1"),
    minAmountOut: ethers.utils.parseUnits("100", 6),
    recipient: wallet.address,
    deadline: Math.floor(Date.now() / 1000) + 600,
    nonce: 0,
  };

  const signature = "0x..."; // signed intent from frontend

  const tx = await contract.executeSwap(
    intent,
    signature,
    { value: intent.amountIn }
  );
  console.log("Executing tx:", tx.hash);
  await tx.wait();
  console.log("✅ Swap executed.");
};

main().catch(console.error);
