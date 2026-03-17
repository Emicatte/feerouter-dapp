# FeeRouter dApp

B2B Payment Gateway su Base Network con fee-splitting automatico (0.5%).

## Requirements

- Node.js >= 20.x
- npm >= 10.x
- Foundry (per deploy smart contract)

## Setup

### 1. Clona il repository
```bash
git clone https://github.com/TUO_USERNAME/feerouter-dapp.git
cd feerouter-dapp
```

### 2. Installa dipendenze
```bash
npm install --legacy-peer-deps
```

### 3. Configura variabili d'ambiente
```bash
cp .env.local.example .env.local
```
Apri `.env.local` e compila:
- `NEXT_PUBLIC_WC_PROJECT_ID` → ottieni su https://cloud.walletconnect.com
- `NEXT_PUBLIC_TREASURY_ADDRESS` → il tuo wallet fee

### 4. Avvia in sviluppo
```bash
npm run dev
```
Apri http://localhost:3000

## Smart Contract (Foundry)
```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts --no-git
forge build
```

Per il deploy vedi `contracts/DEPLOY_GUIDE.md`.

## Stack
- Next.js 14 (App Router)
- Wagmi v2 + Viem
- RainbowKit
- Tailwind CSS
- Solidity 0.8.24 + OpenZeppelin v5
- Foundry

## Network
- Base Mainnet (chain 8453)
- Base Sepolia (testnet)
