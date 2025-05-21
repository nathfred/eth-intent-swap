// packages/nextjs/components/IntentSignForm.tsx
"use client";

import { useAccount, useSignTypedData, usePublicClient, useWalletClient } from "wagmi";
import { parseEther } from "viem";
import { useState } from "react";

export default function IntentSignForm({ contractAddress, usdcAddress }: { contractAddress: string, usdcAddress: string }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [signature, setSignature] = useState<string>("");

  const signIntent = async () => {
    if (!walletClient || !address) return;

    const chainId = await publicClient.getChainId();
    const nonce = 0; // You'd typically fetch this from the smart contract

    const domain = {
      name: "IntentSwap",
      version: "1",
      chainId,
      verifyingContract: contractAddress,
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

    const value = {
      fromToken: "0x0000000000000000000000000000000000000000", // ETH
      toToken: usdcAddress,
      amountIn: parseEther("0.1"),
      minAmountOut: parseEther("100"),
      recipient: address,
      deadline: Math.floor(Date.now() / 1000) + 600,
      nonce,
    };

    const sig = await walletClient.signTypedData({ domain, types, value });
    setSignature(sig);
    console.log("Signature:", sig);
  };

  return (
    <div className="p-4 border rounded-lg space-y-2">
      <h2 className="text-xl font-bold">Sign Intent</h2>
      <button
        onClick={signIntent}
        className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
      >
        Sign Intent
      </button>
      {signature && (
        <div className="break-all">
          <strong>Signature:</strong>
          <div>{signature}</div>
        </div>
      )}
    </div>
  );
}
