// packages/relayer/index.js
require("dotenv").config();
const { ethers } = require("ethers");
const contractABI = require("./IntentSwap.json");

// Configuration
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const POLLING_INTERVAL = parseInt(process.env.POLLING_INTERVAL) || 5000; // 5 seconds default
const MAX_GAS_PRICE = ethers.utils.parseUnits(
  process.env.MAX_GAS_PRICE || "50",
  "gwei"
);
const GAS_LIMIT = parseInt(process.env.GAS_LIMIT) || 500000;
const MIN_PROFIT_WEI = ethers.utils.parseEther(
  process.env.MIN_PROFIT_ETH || "0.001"
); // Minimum profit to fulfill intent

// Validation
if (!RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
  console.error(
    "❌ Missing required environment variables: RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS"
  );
  process.exit(1);
}

// EIP-712 Domain and Types (matching your contract)
const DOMAIN_NAME = "IntentSwap";
const DOMAIN_VERSION = "1";
const SWAP_TYPEHASH =
  "SwapIntent(address fromToken,address toToken,uint256 amountIn,uint256 minAmountOut,address recipient,uint256 deadline,uint256 nonce)";

class IntentRelayer {
  constructor() {
    this.provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    this.wallet = new ethers.Wallet(PRIVATE_KEY, this.provider);
    this.contract = new ethers.Contract(
      CONTRACT_ADDRESS,
      contractABI,
      this.wallet
    );
    this.isRunning = false;
    this.processedIntents = new Set(); // Prevent duplicate processing
    this.processedSignedIntents = new Set(); // For signature-based intents
    this.nonce = null;
    this.chainId = null;
    this.domainSeparator = null;

    // Event listeners for real-time processing
    this.setupEventListeners();
  }

  async initialize() {
    try {
      // Get network info
      const network = await this.provider.getNetwork();
      this.chainId = network.chainId;
      console.log(
        `🌐 Connected to ${network.name} (chainId: ${network.chainId})`
      );

      // Calculate domain separator
      this.domainSeparator = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["bytes32", "bytes32", "bytes32", "uint256", "address"],
          [
            ethers.utils.keccak256(
              ethers.utils.toUtf8Bytes(
                "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
              )
            ),
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes(DOMAIN_NAME)),
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes(DOMAIN_VERSION)),
            this.chainId,
            CONTRACT_ADDRESS,
          ]
        )
      );

      // Validate wallet
      const balance = await this.wallet.getBalance();
      console.log(
        `💰 Relayer balance: ${ethers.utils.formatEther(balance)} ETH`
      );

      if (balance.lt(ethers.utils.parseEther("0.01"))) {
        console.warn("⚠️  Low balance warning: Less than 0.01 ETH");
      }

      // Validate contract
      const code = await this.provider.getCode(CONTRACT_ADDRESS);
      if (code === "0x") {
        throw new Error("Contract not found at specified address");
      }

      // Check if relayer is authorized (if authorization is required)
      try {
        const isAuthorized = await this.contract.authorizedFulfillers(
          this.wallet.address
        );
        console.log(`🔐 Fulfiller authorization status: ${isAuthorized}`);

        if (!isAuthorized) {
          console.warn(
            "⚠️  Relayer is not authorized as fulfiller. Only owner can fulfill intents."
          );
        }
      } catch (error) {
        console.warn("⚠️  Could not check authorization status");
      }

      // Get current nonce
      this.nonce = await this.wallet.getTransactionCount();
      console.log(`✅ Initialized successfully. Current nonce: ${this.nonce}`);
    } catch (error) {
      console.error("❌ Initialization failed:", error.message);
      throw error;
    }
  }

  setupEventListeners() {
    // Listen for new intents created
    this.contract.on(
      "IntentCreated",
      (
        intentId,
        creator,
        fromToken,
        toToken,
        amountIn,
        minAmountOut,
        deadline,
        event
      ) => {
        console.log(`🆕 New intent created: ID ${intentId.toString()}`);
        // Process immediately for faster execution
        this.processSingleStoredIntent(intentId.toNumber()).catch(
          console.error
        );
      }
    );

    // Listen for contract events
    this.contract.on("IntentFulfilled", (intentId, fulfiller) => {
      console.log(`✅ Intent ${intentId.toString()} fulfilled by ${fulfiller}`);
      this.processedIntents.add(intentId.toString());
    });

    this.contract.on("IntentCancelled", (intentId, creator) => {
      console.log(`❌ Intent ${intentId.toString()} cancelled by ${creator}`);
      this.processedIntents.add(intentId.toString());
    });
  }

  // Validate signature-based intent
  async validateSignedIntent(intent, signature) {
    // Basic validation
    if (!intent || !signature) {
      throw new Error("Missing intent or signature");
    }

    // Validate addresses
    if (
      !ethers.utils.isAddress(intent.fromToken) ||
      !ethers.utils.isAddress(intent.toToken) ||
      !ethers.utils.isAddress(intent.recipient)
    ) {
      throw new Error("Invalid token or recipient address");
    }

    // Validate amounts
    if (intent.amountIn.lte(0) || intent.minAmountOut.lte(0)) {
      throw new Error("Invalid amounts");
    }

    // Validate deadline
    const now = Math.floor(Date.now() / 1000);
    if (intent.deadline <= now) {
      throw new Error("Intent expired");
    }

    // Check if already processed
    const intentHash = this.getSignedIntentHash(intent);
    if (this.processedSignedIntents.has(intentHash)) {
      throw new Error("Intent already processed");
    }

    // Validate signature
    const isValidSignature = await this.verifySignature(intent, signature);
    if (!isValidSignature) {
      throw new Error("Invalid signature");
    }

    // Check nonce
    const currentNonce = await this.contract.nonces(intent.recipient);
    if (!intent.nonce.eq(currentNonce)) {
      throw new Error(
        `Invalid nonce. Expected: ${currentNonce.toString()}, Got: ${intent.nonce.toString()}`
      );
    }

    return true;
  }

  // Verify EIP-712 signature
  async verifySignature(intent, signature) {
    try {
      const structHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          [
            "bytes32",
            "address",
            "address",
            "uint256",
            "uint256",
            "address",
            "uint256",
            "uint256",
          ],
          [
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes(SWAP_TYPEHASH)),
            intent.fromToken,
            intent.toToken,
            intent.amountIn,
            intent.minAmountOut,
            intent.recipient,
            intent.deadline,
            intent.nonce,
          ]
        )
      );

      const digest = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "bytes32", "bytes32"],
          ["\x19\x01", this.domainSeparator, structHash]
        )
      );

      const recoveredAddress = ethers.utils.recoverAddress(digest, signature);
      return recoveredAddress.toLowerCase() === intent.recipient.toLowerCase();
    } catch (error) {
      console.error("Signature verification error:", error);
      return false;
    }
  }

  getSignedIntentHash(intent) {
    return ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        [
          "address",
          "address",
          "uint256",
          "uint256",
          "address",
          "uint256",
          "uint256",
        ],
        [
          intent.fromToken,
          intent.toToken,
          intent.amountIn,
          intent.minAmountOut,
          intent.recipient,
          intent.deadline,
          intent.nonce,
        ]
      )
    );
  }

  // Execute signature-based swap
  async executeSignedSwap(intent, signature) {
    const intentHash = this.getSignedIntentHash(intent);

    try {
      console.log(`🔄 Processing signed intent: ${intentHash.slice(0, 10)}...`);

      // Validate intent
      await this.validateSignedIntent(intent, signature);

      // Check gas price
      const gasPrice = await this.provider.getGasPrice();
      if (gasPrice.gt(MAX_GAS_PRICE)) {
        throw new Error(
          `Gas price too high: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`
        );
      }

      // Estimate gas
      const gasLimit = await this.estimateGasForSignedSwap(intent, signature);

      // Prepare transaction options
      const txOptions = {
        gasLimit,
        gasPrice,
        nonce: this.nonce,
      };

      // Add value if swapping from ETH
      if (intent.fromToken === ethers.constants.AddressZero) {
        txOptions.value = intent.amountIn;
      }

      console.log(
        `📤 Executing signed swap with gas limit: ${gasLimit.toString()}, gas price: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`
      );

      // Execute transaction
      const tx = await this.contract.executeSwap(intent, signature, txOptions);
      console.log(`🚀 Signed swap transaction submitted: ${tx.hash}`);

      // Wait for confirmation
      const receipt = await tx.wait();
      console.log(
        `✅ Signed swap executed successfully in block ${receipt.blockNumber}`
      );

      // Mark as processed
      this.processedSignedIntents.add(intentHash);
      this.nonce++;

      return { success: true, txHash: tx.hash, receipt };
    } catch (error) {
      console.error(
        `❌ Failed to execute signed swap for intent ${intentHash.slice(0, 10)}...:`,
        error.message
      );

      // Handle nonce issues
      if (error.code === "NONCE_EXPIRED" || error.message.includes("nonce")) {
        console.log("🔄 Refreshing nonce...");
        this.nonce = await this.wallet.getTransactionCount();
      }

      return { success: false, error: error.message };
    }
  }

  async estimateGasForSignedSwap(intent, signature) {
    try {
      const gasEstimate = await this.contract.estimateGas.executeSwap(
        intent,
        signature,
        {
          value:
            intent.fromToken === ethers.constants.AddressZero
              ? intent.amountIn
              : ethers.BigNumber.from(0),
          from: this.wallet.address,
        }
      );

      // Add 20% buffer
      return gasEstimate.mul(120).div(100);
    } catch (error) {
      console.warn(
        "⚠️  Gas estimation failed for signed swap, using default:",
        error.message
      );
      return ethers.BigNumber.from(GAS_LIMIT);
    }
  }

  // Process stored intents
  async getUnfulfilledIntents() {
    try {
      const nextIntentId = await this.contract.nextIntentId();
      const unfulfilledIntents = [];

      // Check last 100 intents (adjust based on your needs)
      const startId = Math.max(1, nextIntentId.toNumber() - 100);

      for (let i = startId; i < nextIntentId.toNumber(); i++) {
        if (this.processedIntents.has(i.toString())) {
          continue;
        }

        try {
          const intent = await this.contract.getIntent(i);

          // Skip if intent doesn't exist, is fulfilled, cancelled, or expired
          if (intent.id.eq(0) || intent.fulfilled || intent.cancelled) {
            this.processedIntents.add(i.toString());
            continue;
          }

          if (intent.deadline.lt(Math.floor(Date.now() / 1000))) {
            console.log(`⏰ Intent ${i} expired`);
            this.processedIntents.add(i.toString());
            continue;
          }

          // Check if profitable to fulfill
          const isProfitable = await this.isIntentProfitable(intent);
          if (isProfitable) {
            unfulfilledIntents.push({ id: i, intent });
          }
        } catch (error) {
          console.warn(`⚠️  Error checking intent ${i}:`, error.message);
        }
      }

      return unfulfilledIntents;
    } catch (error) {
      console.error("❌ Error fetching unfulfilled intents:", error.message);
      return [];
    }
  }

  async isIntentProfitable(intent) {
    try {
      // Simple profitability check - you can make this more sophisticated
      // Check if the intent amount is above minimum threshold
      if (intent.amountIn.lt(ethers.utils.parseEther("0.01"))) {
        return false;
      }

      // Estimate gas cost
      const gasPrice = await this.provider.getGasPrice();
      const estimatedGasCost = gasPrice.mul(GAS_LIMIT);

      // For now, we'll fulfill if gas cost is less than 10% of swap amount
      const maxGasCost = intent.amountIn.div(10);

      return estimatedGasCost.lt(maxGasCost);
    } catch (error) {
      console.warn("⚠️  Error checking profitability:", error.message);
      return false;
    }
  }

  async fulfillStoredIntent(intentId) {
    try {
      console.log(`🔄 Fulfilling stored intent: ${intentId}`);

      // Check gas price
      const gasPrice = await this.provider.getGasPrice();
      if (gasPrice.gt(MAX_GAS_PRICE)) {
        throw new Error(
          `Gas price too high: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`
        );
      }

      // Estimate gas
      const gasEstimate =
        await this.contract.estimateGas.fulfillIntent(intentId);
      const gasLimit = gasEstimate.mul(120).div(100); // Add 20% buffer

      // Execute transaction
      const tx = await this.contract.fulfillIntent(intentId, {
        gasLimit,
        gasPrice,
        nonce: this.nonce,
      });

      console.log(`🚀 Fulfill transaction submitted: ${tx.hash}`);

      // Wait for confirmation
      const receipt = await tx.wait();
      console.log(
        `✅ Intent ${intentId} fulfilled successfully in block ${receipt.blockNumber}`
      );

      // Mark as processed
      this.processedIntents.add(intentId.toString());
      this.nonce++;

      return { success: true, txHash: tx.hash, receipt };
    } catch (error) {
      console.error(`❌ Failed to fulfill intent ${intentId}:`, error.message);

      // Handle nonce issues
      if (error.code === "NONCE_EXPIRED" || error.message.includes("nonce")) {
        console.log("🔄 Refreshing nonce...");
        this.nonce = await this.wallet.getTransactionCount();
      }

      return { success: false, error: error.message };
    }
  }

  async processSingleStoredIntent(intentId) {
    if (this.processedIntents.has(intentId.toString())) {
      return;
    }

    try {
      const intent = await this.contract.getIntent(intentId);

      if (intent.id.eq(0) || intent.fulfilled || intent.cancelled) {
        this.processedIntents.add(intentId.toString());
        return;
      }

      if (intent.deadline.lt(Math.floor(Date.now() / 1000))) {
        console.log(`⏰ Intent ${intentId} expired`);
        this.processedIntents.add(intentId.toString());
        return;
      }

      const isProfitable = await this.isIntentProfitable(intent);
      if (isProfitable) {
        await this.fulfillStoredIntent(intentId);
      } else {
        console.log(`💸 Intent ${intentId} not profitable, skipping`);
      }
    } catch (error) {
      console.error(
        `❌ Error processing stored intent ${intentId}:`,
        error.message
      );
    }
  }

  async processStoredIntents() {
    try {
      const unfulfilledIntents = await this.getUnfulfilledIntents();

      if (unfulfilledIntents.length === 0) {
        return;
      }

      console.log(
        `📥 Processing ${unfulfilledIntents.length} stored intents...`
      );

      // Process intents sequentially to avoid nonce conflicts
      let successful = 0;
      let failed = 0;

      for (const { id } of unfulfilledIntents) {
        const result = await this.fulfillStoredIntent(id);
        if (result.success) {
          successful++;
        } else {
          failed++;
        }

        // Small delay to avoid overwhelming the network
        await this.sleep(1000);
      }

      console.log(
        `📊 Processed ${unfulfilledIntents.length} stored intents: ${successful} successful, ${failed} failed`
      );
    } catch (error) {
      console.error("❌ Error processing stored intents:", error.message);
    }
  }

  // Mock method to simulate getting signed intents from a queue/API
  async getSignedIntentsFromQueue() {
    // In a real implementation, this would:
    // 1. Connect to a message queue (Redis, RabbitMQ, etc.)
    // 2. Fetch from a REST API
    // 3. Read from a database

    // For demo purposes, returning empty array
    return [];
  }

  async processSignedIntents() {
    try {
      const signedIntents = await this.getSignedIntentsFromQueue();

      if (signedIntents.length === 0) {
        return;
      }

      console.log(`📥 Processing ${signedIntents.length} signed intents...`);

      // Process intents sequentially to avoid nonce conflicts
      let successful = 0;
      let failed = 0;

      for (const { intent, signature } of signedIntents) {
        const result = await this.executeSignedSwap(intent, signature);
        if (result.success) {
          successful++;
        } else {
          failed++;
        }

        // Small delay to avoid overwhelming the network
        await this.sleep(1000);
      }

      console.log(
        `📊 Processed ${signedIntents.length} signed intents: ${successful} successful, ${failed} failed`
      );
    } catch (error) {
      console.error("❌ Error processing signed intents:", error.message);
    }
  }

  async processAllIntents() {
    // Process both types of intents
    await Promise.all([
      this.processStoredIntents(),
      this.processSignedIntents(),
    ]);
  }

  async start() {
    if (this.isRunning) {
      console.log("⚠️  Relayer is already running");
      return;
    }

    await this.initialize();
    this.isRunning = true;

    console.log(
      `🚀 Intent relayer started. Polling every ${POLLING_INTERVAL}ms`
    );
    console.log(`📋 Monitoring both stored intents and signature-based swaps`);

    // Main processing loop
    while (this.isRunning) {
      await this.processAllIntents();
      await this.sleep(POLLING_INTERVAL);
    }
  }

  stop() {
    console.log("🛑 Stopping relayer...");
    this.isRunning = false;

    // Remove event listeners
    this.contract.removeAllListeners();
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Utility methods for testing and monitoring
  async getContractInfo() {
    try {
      const [paused, feeBps, feeRecipient, nextIntentId] = await Promise.all([
        this.contract.paused(),
        this.contract.feeBps(),
        this.contract.feeRecipient(),
        this.contract.nextIntentId(),
      ]);

      return {
        paused,
        feeBps: feeBps.toNumber(),
        feeRecipient,
        nextIntentId: nextIntentId.toNumber(),
        relayerAddress: this.wallet.address,
      };
    } catch (error) {
      console.error("Error getting contract info:", error);
      return null;
    }
  }
}

// Example usage and testing
async function main() {
  const relayer = new IntentRelayer();

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n🛑 Received SIGINT, shutting down gracefully...");
    relayer.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
    relayer.stop();
    process.exit(0);
  });

  try {
    // Show contract info
    const contractInfo = await relayer.getContractInfo();
    if (contractInfo) {
      console.log("📋 Contract Info:", contractInfo);
    }

    await relayer.start();
  } catch (error) {
    console.error("❌ Relayer failed to start:", error.message);
    process.exit(1);
  }
}

// For testing individual operations
async function testStoredIntent() {
  const relayer = new IntentRelayer();
  await relayer.initialize();

  // Test with a specific intent ID
  const intentId = 1; // Replace with actual intent ID
  const result = await relayer.fulfillStoredIntent(intentId);
  console.log("Stored intent test result:", result);
}

async function testSignedSwap() {
  const relayer = new IntentRelayer();
  await relayer.initialize();

  // Get user's current nonce
  const userAddress = "0x..."; // Replace with actual user address
  const currentNonce = await relayer.contract.nonces(userAddress);

  const intent = {
    fromToken: ethers.constants.AddressZero, // ETH
    toToken: "0xA0b86a33E6441b83A2dBE73D8EC3Ce9a3c9f4dD0", // Replace with actual token
    amountIn: ethers.utils.parseEther("0.1"),
    minAmountOut: ethers.utils.parseUnits("100", 6),
    recipient: userAddress,
    deadline: Math.floor(Date.now() / 1000) + 600, // 10 minutes
    nonce: currentNonce,
  };

  // In real usage, you'd get this signature from the frontend
  const signature = "0x1234567890abcdef..."; // Replace with actual signature

  const result = await relayer.executeSignedSwap(intent, signature);
  console.log("Signed swap test result:", result);
}

// Export for use in other modules
module.exports = { IntentRelayer, main, testStoredIntent, testSignedSwap };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
