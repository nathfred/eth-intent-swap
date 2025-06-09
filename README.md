# 🦄 eth-intent-swap

**Simple intent-based swap in ETH**  
Built on [Scaffold-ETH 2](https://github.com/scaffold-eth/scaffold-eth-2)

## ✨ Overview

`eth-intent-swap` is a lightweight prototype demonstrating gasless, intent-based asset swaps on Ethereum. Users sign swap intents off-chain, and a relayer executes them on-chain—enabling a flexible, UX-friendly swap experience. This is built using Scaffold-ETH 2 for fast development and testing.

## 🔧 Features

- ✅ Intent-based swaps using EIP-712 signatures  
- ✅ Supports ETH → Token and Token → Token swaps via Uniswap V2  
- ✅ Fully gasless for users (relayer pays gas)  
- ✅ Local relayer for executing signed intents  
- ✅ Scaffold-ETH 2 frontend with wallet integration

## 🛠️ Tech Stack

- [Scaffold-ETH 2](https://github.com/scaffold-eth/scaffold-eth-2)
- Solidity & Hardhat  
- Ethers.js & Wagmi  
- Uniswap V2 Router  
- TypeScript & Next.js (frontend)

## 🚀 Getting Started

### 1. Clone the Repo

```bash
git clone https://github.com/yourusername/eth-intent-swap.git
cd eth-intent-swap
```

### 2. Install Dependencies
```bash
Copy
Edit
pnpm install
```

### 3. Run Local Node & Frontend
```bash
Copy
Edit
```

# Run local Hardhat node
pnpm chain
# Deploy contracts to local chain
pnpm deploy

# Start the frontend
pnpm dev
4. Sign and Execute a Swap
Sign an intent from the frontend

Trigger backend/relayer to execute on-chain

### 5. Run the Relayer
```bash
Copy
Edit
pnpm relayer
```

📁 Project Structure
pgsql
Copy
Edit
contracts/        → Solidity smart contracts (IntentSwap, tokens)
frontend/         → Scaffold-ETH 2 frontend
scripts/          → Deployment scripts
relayer/          → Off-chain relayer to execute signed intents
🧪 Local Testing
Uses Hardhat for testing contracts

Use mockERC20 tokens to simulate swaps

Preload test wallets with ETH & tokens on local node

📜 License
MIT License

Built with ❤️ using Scaffold-ETH 2


Let me know if you want badges (build, license, etc.), GIFs/screenshots, or more details for deployment to testnets/mainnet.
