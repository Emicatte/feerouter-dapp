/**
 * src/lib/tokens/resolver.ts — Token metadata resolver
 *
 * Resolves token name, symbol, decimals from on-chain data via multicall.
 * Caches results in memory keyed by `${chainId}:${address}`.
 * Falls back to known token list metadata when available.
 */

import type { PublicClient } from 'viem';
import { getAddress } from 'viem';
import { ERC20_ABI } from '../../constants/abis/erc20';
import type { Token } from '../../types/token';
import type { ResolvedTokenMeta } from '../../types/token';
import { findToken } from '../../config/tokens';
import { NATIVE_ADDRESS } from '../../constants/addresses';

/** In-memory cache: key = `${chainId}:${lowercaseAddress}` */
const resolveCache = new Map<string, Token>();

/**
 * Build a cache key for a token on a specific chain.
 * @internal
 */
function cacheKey(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

/**
 * Resolve token metadata from on-chain contract calls via multicall.
 * Reads name(), symbol(), decimals() in a single RPC batch.
 * @param client - Viem public client
 * @param address - Token contract address
 */
export async function resolveTokenMetadata(
  client: PublicClient,
  address: `0x${string}`,
): Promise<ResolvedTokenMeta> {
  const contracts = [
    { address, abi: ERC20_ABI, functionName: 'name' as const },
    { address, abi: ERC20_ABI, functionName: 'symbol' as const },
    { address, abi: ERC20_ABI, functionName: 'decimals' as const },
  ];

  const results = await client.multicall({ contracts });

  const name = results[0].status === 'success' ? (results[0].result as string) : 'Unknown';
  const symbol = results[1].status === 'success' ? (results[1].result as string) : '???';
  const decimals = results[2].status === 'success' ? Number(results[2].result) : 18;

  return { name, symbol, decimals };
}

/**
 * Build a full Token object from an address by resolving on-chain data.
 *
 * Resolution order:
 * 1. Check in-memory cache
 * 2. Check known token list (config/tokens.ts) — more reliable metadata
 * 3. Resolve on-chain via multicall
 *
 * @param client - Viem public client
 * @param address - Token contract address
 * @param chainId - Chain ID
 */
export async function resolveToken(
  client: PublicClient,
  address: `0x${string}`,
  chainId: number,
): Promise<Token> {
  // Native token — don't resolve on-chain
  if (address.toLowerCase() === NATIVE_ADDRESS.toLowerCase()) {
    const known = findToken(NATIVE_ADDRESS, chainId);
    if (known) return known;
    return {
      address: NATIVE_ADDRESS,
      chainId,
      decimals: 18,
      symbol: 'ETH',
      name: 'Ether',
      isNative: true,
    };
  }

  const key = cacheKey(chainId, address);

  // 1. Cache hit
  const cached = resolveCache.get(key);
  if (cached) return cached;

  // 2. Known token list
  const known = findToken(address, chainId);
  if (known) {
    resolveCache.set(key, known);
    return known;
  }

  // 3. On-chain resolution
  const checksummed = getAddress(address);
  const meta = await resolveTokenMetadata(client, checksummed);

  const token: Token = {
    address: checksummed,
    chainId,
    decimals: meta.decimals,
    symbol: meta.symbol,
    name: meta.name,
  };

  resolveCache.set(key, token);
  return token;
}

/**
 * Batch-resolve multiple tokens in parallel.
 * Uses the same resolution order as resolveToken for each address.
 * @param client - Viem public client
 * @param addresses - Array of token addresses
 * @param chainId - Chain ID
 */
export async function batchResolveTokens(
  client: PublicClient,
  addresses: `0x${string}`[],
  chainId: number,
): Promise<Token[]> {
  return Promise.all(
    addresses.map((addr) => resolveToken(client, addr, chainId)),
  );
}

/**
 * Validate that an address is a valid ERC20 contract by checking
 * that it responds to decimals(). Returns true if valid.
 * @param client - Viem public client
 * @param address - Address to validate
 */
export async function isValidERC20(
  client: PublicClient,
  address: `0x${string}`,
): Promise<boolean> {
  try {
    const result = await client.multicall({
      contracts: [
        { address, abi: ERC20_ABI, functionName: 'decimals' as const },
        { address, abi: ERC20_ABI, functionName: 'symbol' as const },
      ],
    });
    return result[0].status === 'success' && result[1].status === 'success';
  } catch {
    return false;
  }
}

/**
 * Clear the resolve cache for a specific chain, or all chains.
 * @param chainId - Optional chain ID to clear (clears all if omitted)
 */
export function clearResolveCache(chainId?: number): void {
  if (chainId === undefined) {
    resolveCache.clear();
    return;
  }
  const prefix = `${chainId}:`;
  for (const key of resolveCache.keys()) {
    if (key.startsWith(prefix)) {
      resolveCache.delete(key);
    }
  }
}
