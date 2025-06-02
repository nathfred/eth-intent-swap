import { TypedDataDomain, TypedDataField } from "ethers";
import { ethers } from "ethers";

export async function signSwapIntent(
  signer: ethers.Signer,
  intent: {
    fromToken: string;
    toToken: string;
    amountIn: bigint;
    minAmountOut: bigint;
    recipient: string;
    deadline: bigint;
    nonce: bigint;
  },
  contractAddress: string,
  chainId: number,
) {
  const domain: TypedDataDomain = {
    name: "IntentSwap",
    version: "1",
    chainId,
    verifyingContract: contractAddress,
  };

  const types: Record<string, TypedDataField[]> = {
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
    fromToken: intent.fromToken,
    toToken: intent.toToken,
    amountIn: intent.amountIn.toString(),
    minAmountOut: intent.minAmountOut.toString(),
    recipient: intent.recipient,
    deadline: intent.deadline.toString(),
    nonce: intent.nonce.toString(),
  };

  return await signer.signTypedData(domain, types, value);
}
