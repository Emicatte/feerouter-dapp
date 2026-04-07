/**
 * src/config/wagmi.ts — wagmi v2 configuration with connectors
 *
 * Creates the wagmi config with chain definitions, transports,
 * and connector setup for MetaMask, WalletConnect, and Coinbase Wallet.
 * Uses fallback transports with custom RPC endpoints from environment.
 * Supports all 11 chains in the registry.
 */

import { http, createConfig } from 'wagmi';
import {
  mainnet,
  optimism,
  bsc,
  polygon,
  zksync,
  base,
  arbitrum,
  celo,
  avalanche,
  blast,
  baseSepolia,
} from 'wagmi/chains';
import { injected, walletConnect, coinbaseWallet } from 'wagmi/connectors';
import { fallback } from 'viem';

/** WalletConnect project ID (from env) */
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? '';

/** Custom RPC endpoints from environment (optional — falls back to public RPCs) */
const RPC_ETHEREUM = process.env.NEXT_PUBLIC_RPC_ETHEREUM;
const RPC_OPTIMISM = process.env.NEXT_PUBLIC_RPC_OPTIMISM;
const RPC_BNB = process.env.NEXT_PUBLIC_RPC_BNB;
const RPC_POLYGON = process.env.NEXT_PUBLIC_RPC_POLYGON;
const RPC_ZKSYNC = process.env.NEXT_PUBLIC_RPC_ZKSYNC;
const RPC_BASE = process.env.NEXT_PUBLIC_RPC_BASE;
const RPC_ARBITRUM = process.env.NEXT_PUBLIC_RPC_ARBITRUM;
const RPC_CELO = process.env.NEXT_PUBLIC_RPC_CELO;
const RPC_AVALANCHE = process.env.NEXT_PUBLIC_RPC_AVALANCHE;
const RPC_BLAST = process.env.NEXT_PUBLIC_RPC_BLAST;
const RPC_BASE_SEPOLIA = process.env.NEXT_PUBLIC_RPC_BASE_SEPOLIA;

/**
 * Create the wagmi config for the wallet connector.
 * Supports 11 chains with fallback HTTP transports.
 */
export const wagmiConfig = createConfig({
  chains: [
    base, mainnet, arbitrum, optimism, polygon,
    bsc, avalanche, celo, blast, zksync, baseSepolia,
  ],
  connectors: [
    injected(),
    walletConnect({ projectId: WC_PROJECT_ID }),
    coinbaseWallet({ appName: 'Web3 Wallet Connect' }),
  ],
  transports: {
    [mainnet.id]: fallback([
      http(RPC_ETHEREUM || 'https://eth.llamarpc.com'),
      http('https://rpc.ankr.com/eth'),
      http('https://ethereum.publicnode.com'),
    ]),
    [optimism.id]: fallback([
      http(RPC_OPTIMISM || 'https://mainnet.optimism.io'),
      http('https://optimism.publicnode.com'),
      http('https://rpc.ankr.com/optimism'),
    ]),
    [bsc.id]: fallback([
      http(RPC_BNB || 'https://bsc-dataseed.binance.org'),
      http('https://bsc.publicnode.com'),
      http('https://rpc.ankr.com/bsc'),
    ]),
    [polygon.id]: fallback([
      http(RPC_POLYGON || 'https://polygon-rpc.com'),
      http('https://polygon-bor.publicnode.com'),
      http('https://rpc.ankr.com/polygon'),
    ]),
    [zksync.id]: fallback([
      http(RPC_ZKSYNC || 'https://mainnet.era.zksync.io'),
      http('https://zksync-era.blockpi.network/v1/rpc/public'),
    ]),
    [base.id]: fallback([
      http(RPC_BASE || 'https://mainnet.base.org'),
      http('https://base.llamarpc.com'),
      http('https://base.publicnode.com'),
    ]),
    [arbitrum.id]: fallback([
      http(RPC_ARBITRUM || 'https://arb1.arbitrum.io/rpc'),
      http('https://arbitrum.llamarpc.com'),
      http('https://arbitrum-one.publicnode.com'),
    ]),
    [celo.id]: fallback([
      http(RPC_CELO || 'https://forno.celo.org'),
      http('https://celo.publicnode.com'),
      http('https://rpc.ankr.com/celo'),
    ]),
    [avalanche.id]: fallback([
      http(RPC_AVALANCHE || 'https://api.avax.network/ext/bc/C/rpc'),
      http('https://avalanche.publicnode.com'),
      http('https://rpc.ankr.com/avalanche'),
    ]),
    [blast.id]: fallback([
      http(RPC_BLAST || 'https://rpc.blast.io'),
      http('https://blast.blockpi.network/v1/rpc/public'),
    ]),
    [baseSepolia.id]: fallback([
      http(RPC_BASE_SEPOLIA || 'https://sepolia.base.org'),
      http('https://base-sepolia.publicnode.com'),
    ]),
  },
  ssr: true,
});

/** Supported chain objects for UI rendering */
export const SUPPORTED_WAGMI_CHAINS = [
  base, mainnet, arbitrum, optimism, polygon,
  bsc, avalanche, celo, blast, zksync, baseSepolia,
] as const;
