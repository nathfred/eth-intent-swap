"use client";

import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import deployedContracts from "~~/contracts/deployedContracts";

// Updated type definition to handle readonly properties
type DeployedContracts = {
  readonly [chainId: string]: {
    readonly [contractName: string]: {
      readonly address: string;
      readonly abi: readonly any[];
    };
  };
};

interface SwapIntent {
  id: number;
  fromToken: string;
  toToken: string;
  amountIn: string;
  minAmountOut: string;
  deadline: string;
  status: string;
  creator: string;
}

interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

const IntentSwap = () => {
  const [fromToken, setFromToken] = useState("");
  const [toToken, setToToken] = useState("");
  const [amountIn, setAmountIn] = useState("");
  const [minAmountOut, setMinAmountOut] = useState("");
  const [deadline, setDeadline] = useState("");
  const [swapIntents, setSwapIntents] = useState<SwapIntent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userAddress, setUserAddress] = useState<string>("");

  // Common token addresses (you can expand this list)
  const commonTokens: TokenInfo[] = [
    { address: "0x0000000000000000000000000000000000000000", symbol: "ETH", name: "Ethereum", decimals: 18 },
    { address: "0xA0b86a33E6410b55d4f4E5d8e6c8b7b5c1234567", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0xB1c2d3e4f5A6b7c8D9e0F1234567890abcdef123", symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
    { address: "0xC2d3e4f5A6b7c8D9e0F1234567890abcdef12345", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
  ];

  const clearError = () => setError(null);

  const getContract = useCallback(async () => {
    if (!window.ethereum) {
      throw new Error("Please install MetaMask");
    }

    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    setUserAddress(address);

    // Cast to the correct type that matches the readonly structure
    const contracts = deployedContracts as DeployedContracts;

    // Get the current network
    const network = await provider.getNetwork();
    const chainId = network.chainId.toString();

    console.log("Current chainId:", chainId);
    console.log("Available contracts:", Object.keys(contracts));

    if (!contracts[chainId] || !contracts[chainId].IntentSwap) {
      throw new Error(
        `IntentSwap contract not found for network ${chainId}. Available networks: ${Object.keys(contracts).join(", ")}`,
      );
    }

    const contractAddress = contracts[chainId].IntentSwap.address;
    const contractABI = contracts[chainId].IntentSwap.abi;

    console.log("Contract address:", contractAddress);

    return new ethers.Contract(contractAddress, contractABI, signer);
  }, []);

  const fetchSwapIntents = useCallback(async () => {
    try {
      setLoading(true);
      clearError();

      const contract = await getContract();

      console.log("Calling getUserIntents...");

      // First, let's try to get user intents with better error handling
      let userIntents;
      try {
        userIntents = await contract.getUserIntents();
        console.log("Raw userIntents response:", userIntents);
      } catch (contractError) {
        console.error("Contract call failed:", contractError);

        // If getUserIntents fails, let's try to check if user has any intents by checking events
        try {
          const filter = contract.filters.IntentCreated(null, userAddress);
          const events = await contract.queryFilter(filter);
          console.log("IntentCreated events for user:", events);

          if (events.length === 0) {
            setSwapIntents([]);
            return;
          }
        } catch (eventError) {
          console.error("Event query failed:", eventError);
        }

        throw contractError;
      }

      // Handle empty response
      if (!userIntents || userIntents.length === 0) {
        console.log("No intents found for user");
        setSwapIntents([]);
        return;
      }

      const formattedIntents: SwapIntent[] = userIntents.map((intent: any, index: number) => {
        console.log(`Processing intent ${index}:`, intent);

        return {
          id: Number(intent.id || index),
          fromToken: intent.fromToken,
          toToken: intent.toToken,
          amountIn: ethers.formatEther(intent.amountIn),
          minAmountOut: ethers.formatEther(intent.minAmountOut),
          deadline: new Date(Number(intent.deadline) * 1000).toLocaleString(),
          status: intent.fulfilled ? "Fulfilled" : intent.cancelled ? "Cancelled" : "Active",
          creator: intent.creator,
        };
      });

      console.log("Formatted intents:", formattedIntents);
      setSwapIntents(formattedIntents);
    } catch (err) {
      console.error("Error fetching swap intents:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch swap intents");

      // Set empty array on error to prevent further issues
      setSwapIntents([]);
    } finally {
      setLoading(false);
    }
  }, [getContract, userAddress]);

  useEffect(() => {
    fetchSwapIntents();
  }, [fetchSwapIntents]);

  const createSwapIntent = async () => {
    try {
      setLoading(true);
      clearError();

      if (!fromToken || !toToken) {
        throw new Error("Please select both from and to tokens");
      }

      if (!amountIn || parseFloat(amountIn) <= 0) {
        throw new Error("Please enter a valid input amount");
      }

      if (!minAmountOut || parseFloat(minAmountOut) <= 0) {
        throw new Error("Please enter a valid minimum output amount");
      }

      if (!deadline) {
        throw new Error("Please set a deadline");
      }

      // Allow ETH address as 0x0000000000000000000000000000000000000000
      if (fromToken !== "0x0000000000000000000000000000000000000000" && !ethers.isAddress(fromToken)) {
        throw new Error("Please enter a valid from token address");
      }

      if (!ethers.isAddress(toToken)) {
        throw new Error("Please enter a valid to token address");
      }

      const contract = await getContract();
      const deadlineTimestamp = Math.floor(new Date(deadline).getTime() / 1000);

      console.log("Creating swap intent with params:", {
        fromToken,
        toToken,
        amountIn: ethers.parseEther(amountIn).toString(),
        minAmountOut: ethers.parseEther(minAmountOut).toString(),
        deadlineTimestamp,
        value:
          fromToken === "0x0000000000000000000000000000000000000000" ? ethers.parseEther(amountIn).toString() : "0",
      });

      // Create the swap intent
      const tx = await contract.createSwapIntent(
        fromToken,
        toToken,
        ethers.parseEther(amountIn),
        ethers.parseEther(minAmountOut),
        deadlineTimestamp,
        {
          value: fromToken === "0x0000000000000000000000000000000000000000" ? ethers.parseEther(amountIn) : "0",
        },
      );

      console.log("Transaction sent:", tx.hash);
      await tx.wait();
      console.log("Transaction confirmed");

      // Reset form
      setFromToken("");
      setToToken("");
      setAmountIn("");
      setMinAmountOut("");
      setDeadline("");

      // Refresh intents
      await fetchSwapIntents();
    } catch (err) {
      console.error("Error creating swap intent:", err);
      setError(err instanceof Error ? err.message : "Failed to create swap intent");
    } finally {
      setLoading(false);
    }
  };

  const cancelSwapIntent = async (intentId: number) => {
    try {
      setLoading(true);
      clearError();

      const contract = await getContract();
      const tx = await contract.cancelSwapIntent(intentId);
      await tx.wait();

      await fetchSwapIntents();
    } catch (err) {
      console.error("Error cancelling swap intent:", err);
      setError(err instanceof Error ? err.message : "Failed to cancel swap intent");
    } finally {
      setLoading(false);
    }
  };

  const getTokenSymbol = (address: string): string => {
    if (address === "0x0000000000000000000000000000000000000000") return "ETH";
    const token = commonTokens.find(t => t.address.toLowerCase() === address.toLowerCase());
    return token ? token.symbol : `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const setMaxDeadline = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setDeadline(tomorrow.toISOString().slice(0, 16));
  };

  return (
    <div className="flex flex-col items-center p-4 space-y-6 bg-gradient-to-br from-blue-50 to-purple-50 min-h-screen">
      <h2 className="text-3xl font-bold text-gray-800 mb-2">Intent-Based Swap</h2>
      <p className="text-gray-600 text-center max-w-2xl">
        Create swap intents that can be fulfilled by solvers in the network. Set your terms and let the market find the
        best execution.
      </p>

      {userAddress && (
        <div className="text-sm text-gray-600">
          Connected: {userAddress.slice(0, 6)}...{userAddress.slice(-4)}
        </div>
      )}

      {error && (
        <div className="w-full max-w-md p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
          <p>{error}</p>
          <button onClick={clearError} className="mt-2 text-sm underline hover:no-underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="w-full max-w-md bg-white p-6 rounded-xl shadow-lg space-y-4">
        <h3 className="text-xl font-semibold text-gray-800 mb-4">Create Swap Intent</h3>

        {/* From Token */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">From Token</label>
          <select
            className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={fromToken}
            onChange={e => setFromToken(e.target.value)}
            disabled={loading}
          >
            <option value="">Select token to swap from</option>
            {commonTokens.map(token => (
              <option key={token.address} value={token.address}>
                {token.symbol} - {token.name}
              </option>
            ))}
          </select>
          <input
            className="w-full p-2 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            type="text"
            placeholder="Or enter custom token address"
            value={fromToken}
            onChange={e => setFromToken(e.target.value)}
            disabled={loading}
          />
        </div>

        {/* To Token */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">To Token</label>
          <select
            className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={toToken}
            onChange={e => setToToken(e.target.value)}
            disabled={loading}
          >
            <option value="">Select token to receive</option>
            {commonTokens.map(token => (
              <option key={token.address} value={token.address}>
                {token.symbol} - {token.name}
              </option>
            ))}
          </select>
          <input
            className="w-full p-2 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            type="text"
            placeholder="Or enter custom token address"
            value={toToken}
            onChange={e => setToToken(e.target.value)}
            disabled={loading}
          />
        </div>

        {/* Amount In */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Amount to Swap</label>
          <input
            className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            type="number"
            step="0.000001"
            placeholder="0.0"
            value={amountIn}
            onChange={e => setAmountIn(e.target.value)}
            disabled={loading}
          />
        </div>

        {/* Min Amount Out */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Minimum Amount to Receive</label>
          <input
            className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            type="number"
            step="0.000001"
            placeholder="0.0"
            value={minAmountOut}
            onChange={e => setMinAmountOut(e.target.value)}
            disabled={loading}
          />
        </div>

        {/* Deadline */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Deadline</label>
          <div className="flex space-x-2">
            <input
              className="flex-1 p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              type="datetime-local"
              value={deadline}
              onChange={e => setDeadline(e.target.value)}
              disabled={loading}
            />
            <button
              className="px-3 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 text-sm"
              onClick={setMaxDeadline}
              disabled={loading}
            >
              24h
            </button>
          </div>
        </div>

        <button
          className="w-full px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 font-medium"
          onClick={createSwapIntent}
          disabled={loading}
        >
          {loading ? "Creating Intent..." : "Create Swap Intent"}
        </button>
      </div>

      <button
        className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
        onClick={fetchSwapIntents}
        disabled={loading}
      >
        {loading ? "Loading..." : "Refresh Intents"}
      </button>

      <div className="w-full max-w-6xl bg-white p-6 rounded-xl shadow-lg">
        <h3 className="text-2xl font-semibold mb-6 text-gray-800">My Swap Intents</h3>
        {swapIntents.length > 0 ? (
          <div className="space-y-4">
            {swapIntents.map(intent => (
              <div key={intent.id} className="p-4 border rounded-lg hover:shadow-md transition-shadow duration-200">
                <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center space-y-3 lg:space-y-0">
                  <div className="flex flex-col sm:flex-row sm:space-x-6 space-y-2 sm:space-y-0">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-gray-500">ID:</span>
                      <span className="font-medium">{intent.id}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-lg">
                        {intent.amountIn} {getTokenSymbol(intent.fromToken)}
                      </span>
                      <span className="text-gray-500">→</span>
                      <span className="font-semibold text-lg text-green-600">
                        ≥{intent.minAmountOut} {getTokenSymbol(intent.toToken)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-4">
                    <div className="text-sm text-gray-600">
                      <div>Deadline: {intent.deadline}</div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span
                        className={`px-3 py-1 rounded-full text-sm font-medium ${
                          intent.status === "Fulfilled"
                            ? "bg-green-100 text-green-800"
                            : intent.status === "Cancelled"
                              ? "bg-red-100 text-red-800"
                              : "bg-yellow-100 text-yellow-800"
                        }`}
                      >
                        {intent.status}
                      </span>
                      {intent.status === "Active" && (
                        <button
                          className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 text-sm"
                          onClick={() => cancelSwapIntent(intent.id)}
                          disabled={loading}
                        >
                          {loading ? "Cancelling..." : "Cancel"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">
            {loading ? "Loading swap intents..." : "No swap intents found"}
          </p>
        )}
      </div>
    </div>
  );
};

export default IntentSwap;
