"use client";

import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import deployedContracts from "~~/contracts/deployedContracts";

// Type definition for deployed contracts
type DeployedContracts = {
  [chainId: string]: {
    [contractName: string]: {
      address: string;
      abi: any[];
    };
  };
};

interface Expense {
  id: number;
  amount: string;
  status: string;
}

const ExpenseSplitter = () => {
  const [amount, setAmount] = useState("");
  const [participants, setParticipants] = useState<string[]>([""]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = () => setError(null);

  const getContract = useCallback(async () => {
    if (!window.ethereum) {
      throw new Error("Please install MetaMask");
    }

    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();

    // Type assertion to handle the deployed contracts
    const contracts = deployedContracts as DeployedContracts;
    const chainId = "31337"; // or get dynamically from network

    if (!contracts[chainId] || !contracts[chainId].ExpenseSplitter) {
      throw new Error("Contract not found for current network");
    }

    const contractAddress = contracts[chainId].ExpenseSplitter.address;
    const contractABI = contracts[chainId].ExpenseSplitter.abi;

    return new ethers.Contract(contractAddress, contractABI, signer);
  }, []);

  const fetchExpenses = useCallback(async () => {
    try {
      setLoading(true);
      clearError();

      const contract = await getContract();
      const [ids, amounts, statuses] = await contract.getMyExpenses();

      const formattedExpenses: Expense[] = ids.map((id: bigint, index: number) => ({
        id: Number(id),
        amount: ethers.formatEther(amounts[index]),
        status: statuses[index] ? "Withdrawn" : "Active",
      }));

      setExpenses(formattedExpenses);
    } catch (err) {
      console.error("Error fetching expenses:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch expenses");
    } finally {
      setLoading(false);
    }
  }, [getContract]);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  const addExpense = async () => {
    try {
      setLoading(true);
      clearError();

      if (!amount || parseFloat(amount) <= 0) {
        throw new Error("Please enter a valid amount");
      }

      const validParticipants = participants.filter(addr => {
        const trimmed = addr.trim();
        return trimmed && ethers.isAddress(trimmed);
      });

      if (validParticipants.length === 0) {
        throw new Error("Please add at least one valid participant address");
      }

      const contract = await getContract();
      const tx = await contract.addExpense(validParticipants, {
        value: ethers.parseEther(amount),
      });

      await tx.wait();

      // Reset form
      setAmount("");
      setParticipants([""]);

      // Refresh expenses
      await fetchExpenses();
    } catch (err) {
      console.error("Error adding expense:", err);
      setError(err instanceof Error ? err.message : "Failed to add expense");
    } finally {
      setLoading(false);
    }
  };

  const withdrawFunds = async (expenseId: number) => {
    try {
      setLoading(true);
      clearError();

      const contract = await getContract();
      const tx = await contract.withdrawFunds(expenseId);
      await tx.wait();

      await fetchExpenses();
    } catch (err) {
      console.error("Error withdrawing funds:", err);
      setError(err instanceof Error ? err.message : "Failed to withdraw funds");
    } finally {
      setLoading(false);
    }
  };

  const updateParticipant = (index: number, value: string) => {
    const newParticipants = [...participants];
    newParticipants[index] = value;
    setParticipants(newParticipants);
  };

  const addParticipant = () => {
    setParticipants([...participants, ""]);
  };

  const removeParticipant = (index: number) => {
    if (participants.length > 1) {
      setParticipants(participants.filter((_, i) => i !== index));
    }
  };

  return (
    <div className="flex flex-col items-center p-4 space-y-4 bg-gray-100 min-h-screen">
      <h2 className="text-2xl font-bold text-gray-800">Decentralized Expense Splitter</h2>

      {error && (
        <div className="w-full max-w-md p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          <p>{error}</p>
          <button onClick={clearError} className="mt-2 text-sm underline hover:no-underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="w-full max-w-md space-y-4">
        <input
          className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          type="number"
          step="0.001"
          placeholder="Amount in ETH"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          disabled={loading}
        />

        <div className="space-y-2">
          <h3 className="font-semibold text-gray-700">Participants:</h3>
          {participants.map((participant, index) => (
            <div key={index} className="flex space-x-2">
              <input
                className="flex-1 p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                type="text"
                placeholder="Participant Address (0x...)"
                value={participant}
                onChange={e => updateParticipant(index, e.target.value)}
                disabled={loading}
              />
              {participants.length > 1 && (
                <button
                  className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
                  onClick={() => removeParticipant(index)}
                  disabled={loading}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex space-x-2">
          <button
            className="flex-1 px-4 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50"
            onClick={addParticipant}
            disabled={loading}
          >
            Add Participant
          </button>
          <button
            className="flex-1 px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
            onClick={addExpense}
            disabled={loading}
          >
            {loading ? "Processing..." : "Add Expense"}
          </button>
        </div>

        <button
          className="w-full px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
          onClick={fetchExpenses}
          disabled={loading}
        >
          {loading ? "Loading..." : "Refresh Expenses"}
        </button>
      </div>

      <div className="w-full max-w-4xl bg-white p-6 rounded-lg shadow-lg">
        <h3 className="text-xl font-semibold mb-4 text-gray-800">My Expense Splitters</h3>
        {expenses.length > 0 ? (
          <div className="space-y-3">
            {expenses.map(expense => (
              <div
                key={expense.id}
                className="p-4 border rounded-lg flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-2 sm:space-y-0"
              >
                <div className="flex flex-col sm:flex-row sm:space-x-4">
                  <span className="font-medium text-gray-600">ID: {expense.id}</span>
                  <span className="font-bold text-lg">{expense.amount} ETH</span>
                  <span
                    className={`font-semibold ${expense.status === "Withdrawn" ? "text-green-600" : "text-orange-600"}`}
                  >
                    {expense.status}
                  </span>
                </div>
                {expense.status === "Active" && (
                  <button
                    className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
                    onClick={() => withdrawFunds(expense.id)}
                    disabled={loading}
                  >
                    {loading ? "Processing..." : "Withdraw"}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">{loading ? "Loading expenses..." : "No expenses found"}</p>
        )}
      </div>
    </div>
  );
};

export default ExpenseSplitter;
