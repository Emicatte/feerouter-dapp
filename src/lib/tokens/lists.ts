/**
 * src/lib/tokens/lists.ts — Token list aggregator
 *
 * Merges default tokens with external token lists (e.g. Uniswap default list).
 * Provides in-memory caching with 1-hour TTL, deduplication, and search.
 */

import type { Token, TokenList, TokenSearchResult } from '../../types/token';
import { DEFAULT_TOKENS, getDefaultTokens } from '../../config/tokens';

/** Uniswap default token list URL */
const UNISWAP_TOKEN_LIST_URL = 'https://tokens.uniswap.org';

/** Cache TTL: 1 hour in milliseconds */
const CACHE_TTL = 60 * 60 * 1000;

/** Cached external token list */
let cachedExternalTokens: Token[] | null = null;
let cacheTimestamp = 0;

/**
 * Fetch the Uniswap default token list from their CDN.
 * Returns an empty array on failure (fallback to local-only).
 * @internal
 */
async function fetchUniswapTokenList(): Promise<Token[]> {
  try {
    const response = await fetch(UNISWAP_TOKEN_LIST_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];

    const data = (await response.json()) as TokenList;
    return (data.tokens ?? []).map((t) => ({
      address: t.address as `0x${string}`,
      chainId: t.chainId,
      decimals: t.decimals,
      symbol: t.symbol,
      name: t.name,
      logoURI: t.logoURI,
      tags: t.tags,
    }));
  } catch {
    return [];
  }
}

/**
 * Get external tokens with TTL caching.
 * Fetches from Uniswap once per hour; returns cached on subsequent calls.
 * @internal
 */
async function getExternalTokens(): Promise<Token[]> {
  const now = Date.now();
  if (cachedExternalTokens && now - cacheTimestamp < CACHE_TTL) {
    return cachedExternalTokens;
  }
  cachedExternalTokens = await fetchUniswapTokenList();
  cacheTimestamp = now;
  return cachedExternalTokens;
}

/**
 * Get all local default tokens as a flat array.
 * @internal
 */
function getAllLocalTokens(): Token[] {
  return Object.values(DEFAULT_TOKENS).flat();
}

/**
 * Merge multiple token lists, deduplicating by address + chainId.
 * First list has priority (its entries are kept on collision).
 * @param lists - Array of token lists to merge
 */
export function mergeTokenLists(...lists: TokenList[]): Token[] {
  const seen = new Set<string>();
  const merged: Token[] = [];

  for (const list of lists) {
    for (const token of list.tokens) {
      const key = `${token.chainId}:${token.address.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(token);
      }
    }
  }

  return merged;
}

/**
 * Filter tokens by chain ID.
 * @param tokens - Full token array
 * @param chainId - Target chain
 */
export function filterByChain(tokens: Token[], chainId: number): Token[] {
  return tokens.filter((t) => t.chainId === chainId);
}

/**
 * Get all available tokens for a specific chain.
 * Merges local defaults (priority) with external Uniswap list.
 * Deduplicates by chainId + address (case-insensitive).
 * @param chainId - Target chain ID
 */
export async function getTokensForChain(chainId: number): Promise<Token[]> {
  const local = getDefaultTokens(chainId);
  const external = await getExternalTokens();
  const externalForChain = external.filter((t) => t.chainId === chainId);

  // Local tokens take priority — dedup by address
  const seen = new Set<string>(
    local.map((t) => t.address.toLowerCase()),
  );
  const merged = [...local];

  for (const token of externalForChain) {
    const addr = token.address.toLowerCase();
    if (!seen.has(addr)) {
      seen.add(addr);
      merged.push(token);
    }
  }

  return merged;
}

/**
 * Search tokens by name, symbol, or address.
 * Local defaults are searched first, then external list.
 * @param query - Search string (name, symbol, or address)
 * @param chainId - Target chain ID
 */
export async function searchTokens(
  query: string,
  chainId: number,
): Promise<TokenSearchResult[]> {
  const allTokens = await getTokensForChain(chainId);
  const q = query.trim().toLowerCase();

  if (!q) return allTokens.map((token) => ({ token, matchType: 'partial' as const }));

  const results: TokenSearchResult[] = [];
  const isAddressQuery = q.startsWith('0x') && q.length >= 10;

  for (const token of allTokens) {
    // Exact address match
    if (isAddressQuery && token.address.toLowerCase() === q) {
      results.push({ token, matchType: 'exact' });
      continue;
    }

    // Exact symbol match
    if (token.symbol.toLowerCase() === q) {
      results.push({ token, matchType: 'exact' });
      continue;
    }

    // Partial matches: symbol starts with query, name contains query, address starts with query
    if (
      token.symbol.toLowerCase().startsWith(q) ||
      token.name.toLowerCase().includes(q) ||
      (isAddressQuery && token.address.toLowerCase().startsWith(q))
    ) {
      results.push({ token, matchType: 'partial' });
    }
  }

  // Sort: exact matches first, then alphabetical by symbol
  results.sort((a, b) => {
    if (a.matchType !== b.matchType) {
      return a.matchType === 'exact' ? -1 : 1;
    }
    return a.token.symbol.localeCompare(b.token.symbol);
  });

  return results;
}

/**
 * Get tokens for a chain synchronously (local defaults only, no external fetch).
 * Use this when you need sync access and can accept local-only results.
 * @param chainId - Target chain ID
 */
export function getTokensForChainSync(chainId: number): Token[] {
  return getDefaultTokens(chainId);
}

/**
 * Force-clear the external token list cache.
 * Next call to getTokensForChain / searchTokens will re-fetch.
 */
export function clearTokenListCache(): void {
  cachedExternalTokens = null;
  cacheTimestamp = 0;
}
