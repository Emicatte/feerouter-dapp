/**
 * src/lib/evm/client.ts — Viem public/wallet client factory
 *
 * Creates typed viem clients for reading chain state and sending transactions.
 * Supports all 11 chains with singleton caching, fallback transports,
 * automatic retry with backoff, and RPC health checks.
 */

import {
  createPublicClient as viemCreatePublicClient,
  createWalletClient as viemCreateWalletClient,
  http,
  fallback,
  type PublicClient,
  type Chain,
} from 'viem';
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
} from 'viem/chains';
import type { SupportedChainId } from '../../types/chain';
import { getChain } from '../../config/chains';

/** Map chain IDs to viem chain objects */
const VIEM_CHAINS: Record<SupportedChainId, Chain> = {
  1: mainnet,
  10: optimism,
  56: bsc,
  137: polygon,
  324: zksync,
  8453: base,
  42161: arbitrum,
  42220: celo,
  43114: avalanche,
  81457: blast,
  84532: baseSepolia,
};

/** Singleton cache for public clients (keyed by chainId) */
const publicClientCache = new Map<number, PublicClient>();

/**
 * Build a fallback transport for a chain using its configured RPC URLs.
 * Each HTTP transport retries 3 times with 1s delay and 10s timeout.
 * @internal
 */
function buildChainTransport(chainId: SupportedChainId) {
  const chainConfig = getChain(chainId);
  if (!chainConfig) {
    throw new Error(`No chain config for chainId ${chainId}`);
  }

  const urls = [chainConfig.rpcUrls.default, ...chainConfig.rpcUrls.fallback];
  return fallback(
    urls.map((url) =>
      http(url, { retryCount: 3, retryDelay: 1000, timeout: 10_000 }),
    ),
  );
}

/**
 * Create a public client for reading chain state.
 * Uses singleton caching: repeated calls for the same chainId (without
 * a custom rpcUrl) return the same client instance.
 *
 * @param chainId - The target chain ID
 * @param rpcUrl - Optional custom RPC URL override (bypasses cache)
 */
export function createEvmPublicClient(
  chainId: SupportedChainId,
  rpcUrl?: string,
): PublicClient {
  // Return cached client when no custom URL is specified
  if (!rpcUrl) {
    const cached = publicClientCache.get(chainId);
    if (cached) return cached;
  }

  const chain = VIEM_CHAINS[chainId];
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  const transport = rpcUrl
    ? http(rpcUrl, { retryCount: 3, retryDelay: 1000, timeout: 10_000 })
    : buildChainTransport(chainId);

  const client = viemCreatePublicClient({ chain, transport }) as PublicClient;

  // Cache only default-transport clients
  if (!rpcUrl) {
    publicClientCache.set(chainId, client);
  }

  return client;
}

/**
 * Create a wallet client for sending transactions.
 * NOT cached — a fresh client is created per call since the account may change.
 *
 * @param chainId - The target chain ID
 * @param account - The wallet address to sign with
 * @param rpcUrl - Optional custom RPC URL override
 */
export function createEvmWalletClient(
  chainId: SupportedChainId,
  account?: `0x${string}`,
  rpcUrl?: string,
) {
  const chain = VIEM_CHAINS[chainId];
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  const transport = rpcUrl
    ? http(rpcUrl, { retryCount: 3, retryDelay: 1000, timeout: 10_000 })
    : buildChainTransport(chainId);

  return viemCreateWalletClient({
    chain,
    transport,
    ...(account ? { account } : {}),
  });
}

/**
 * Get the viem Chain object for a supported chain ID.
 */
export function getViemChain(chainId: SupportedChainId): Chain {
  const chain = VIEM_CHAINS[chainId];
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return chain;
}

/**
 * Clear the cached public client for a chain (or all chains).
 * Useful when RPC config changes at runtime.
 */
export function clearClientCache(chainId?: SupportedChainId): void {
  if (chainId) {
    publicClientCache.delete(chainId);
  } else {
    publicClientCache.clear();
  }
}

/**
 * Check if an RPC endpoint is reachable by fetching the latest block number.
 * @param chainId - The chain to check
 * @returns true if the RPC responded, false on error or timeout
 */
export async function checkRpcHealth(
  chainId: SupportedChainId,
): Promise<boolean> {
  try {
    const client = createEvmPublicClient(chainId);
    await client.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}
