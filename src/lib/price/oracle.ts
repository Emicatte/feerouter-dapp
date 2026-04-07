/**
 * src/lib/price/oracle.ts — Multi-source price feeds
 *
 * Fetches token prices from multiple sources in priority order:
 * 1. On-chain: Uniswap V3 pool sqrtPriceX96 → price
 * 2. CoinGecko API (free tier, rate limited)
 * 3. Fallback: cached price (max 5 min old)
 *
 * Features: batch pricing, WBTC/BTC peg tracking, rate limiting.
 */

import type { SupportedChainId } from '../../types/chain';
import { createEvmPublicClient } from '../evm/client';
import { CONTRACT_ADDRESSES } from '../../constants/addresses';
import { UNISWAP_V3_FACTORY_ABI } from '../../constants/abis/uniswapV3Factory';
import { getCachedPrice, cachePrice } from './cache';

// ────────────────────────────────────────────────────────────────
// Types (existing preserved + extended)
// ────────────────────────────────────────────────────────────────

/** Price result for a single token */
export interface TokenPrice {
  usd: number;
  eur: number;
  lastUpdated: number;
}

/** Price oracle response */
export type PriceMap = Record<string, TokenPrice>;

/** Extended price result with source and chain context */
export interface PriceResult {
  usd: number;
  source: 'onchain' | 'coingecko' | 'cache';
  timestamp: number;
  /** WBTC/BTC peg ratio (only for BTC-tagged tokens) */
  btcRatio?: number;
}

/** CoinGecko API base URL */
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

/** Minimal Uniswap V3 Pool ABI for slot0 reads */
const POOL_SLOT0_ABI = [
  {
    type: 'function',
    name: 'slot0',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'token0',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'token1',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

// ────────────────────────────────────────────────────────────────
// CoinGecko rate limiter (max 30 calls/min)
// ────────────────────────────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const requestTimestamps: number[] = [];

/**
 * Check if a CoinGecko API call is allowed under rate limit.
 * @internal
 */
function canMakeRequest(): boolean {
  const now = Date.now();
  // Remove timestamps older than window
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
    requestTimestamps.shift();
  }
  return requestTimestamps.length < MAX_REQUESTS_PER_WINDOW;
}

/** Record a request timestamp for rate limiting */
function recordRequest(): void {
  requestTimestamps.push(Date.now());
}

// ────────────────────────────────────────────────────────────────
// CoinGecko ID mapping
// ────────────────────────────────────────────────────────────────

/** Map token symbols to CoinGecko IDs */
const SYMBOL_TO_COINGECKO: Record<string, string> = {
  ETH: 'ethereum',
  WETH: 'ethereum',
  BTC: 'bitcoin',
  WBTC: 'bitcoin',
  'cbBTC': 'bitcoin',
  BTCB: 'bitcoin',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  BNB: 'binancecoin',
  WBNB: 'binancecoin',
  POL: 'matic-network',
  WMATIC: 'matic-network',
  AVAX: 'avalanche-2',
  WAVAX: 'avalanche-2',
  CELO: 'celo',
  OP: 'optimism',
  ARB: 'arbitrum',
  USDB: 'usd-coin', // Blast USDB ~ $1
};

/**
 * Get the CoinGecko ID for a token symbol.
 * @param symbol - Token symbol (case insensitive)
 */
export function getCoingeckoId(symbol: string): string | undefined {
  return SYMBOL_TO_COINGECKO[symbol.toUpperCase()];
}

// ────────────────────────────────────────────────────────────────
// Existing CoinGecko API (preserved)
// ────────────────────────────────────────────────────────────────

/**
 * Fetch prices for a list of CoinGecko IDs.
 * @param ids - CoinGecko token IDs (e.g. ['ethereum', 'usd-coin'])
 */
export async function fetchPrices(ids: string[]): Promise<PriceMap> {
  if (!canMakeRequest()) {
    console.warn('[oracle] CoinGecko rate limit reached, using cached prices');
    return buildCacheFallback(ids);
  }

  recordRequest();
  const idsStr = ids.join(',');
  const res = await fetch(
    `${COINGECKO_API}/simple/price?ids=${idsStr}&vs_currencies=eur,usd`,
  );

  if (!res.ok) {
    throw new Error(`CoinGecko price fetch failed: ${res.status}`);
  }

  const data: Record<string, { eur?: number; usd?: number }> = await res.json();
  const result: PriceMap = {};

  for (const [id, vals] of Object.entries(data)) {
    result[id] = {
      usd: vals.usd ?? 0,
      eur: vals.eur ?? 0,
      lastUpdated: Date.now(),
    };
  }

  return result;
}

/**
 * Get price for a single token.
 * @param id - CoinGecko token ID
 */
export async function fetchSinglePrice(id: string): Promise<TokenPrice | null> {
  const prices = await fetchPrices([id]);
  return prices[id] ?? null;
}

// ────────────────────────────────────────────────────────────────
// On-chain price from Uniswap V3 pool (PROMPT 6)
// ────────────────────────────────────────────────────────────────

/**
 * Read the price of tokenA in terms of tokenB from a Uniswap V3 pool.
 * Uses sqrtPriceX96 from slot0.
 *
 * @param tokenAddress - Token to price
 * @param stableAddress - Stable reference (e.g. USDC address)
 * @param tokenDecimals - Decimals of the token being priced
 * @param stableDecimals - Decimals of the reference token
 * @param feeTier - Pool fee tier (default 3000 = 0.3%)
 * @param chainId - Target chain
 * @returns USD price or null if pool doesn't exist / read fails
 */
export async function fetchOnChainPrice(
  tokenAddress: `0x${string}`,
  stableAddress: `0x${string}`,
  tokenDecimals: number,
  stableDecimals: number,
  feeTier: number,
  chainId: SupportedChainId,
): Promise<number | null> {
  try {
    const client = createEvmPublicClient(chainId);
    const factoryAddress = CONTRACT_ADDRESSES[chainId]?.uniswapV3Factory;
    if (!factoryAddress) return null;

    // Get pool address
    const poolAddress = await client.readContract({
      address: factoryAddress,
      abi: UNISWAP_V3_FACTORY_ABI,
      functionName: 'getPool',
      args: [tokenAddress, stableAddress, feeTier],
    }) as `0x${string}`;

    if (!poolAddress || poolAddress === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    // Read slot0 for sqrtPriceX96
    const slot0 = await client.readContract({
      address: poolAddress,
      abi: POOL_SLOT0_ABI,
      functionName: 'slot0',
    }) as [bigint, number, number, number, number, number, boolean];

    const sqrtPriceX96 = slot0[0];
    if (sqrtPriceX96 === 0n) return null;

    // Read token0 to determine price direction
    const token0 = await client.readContract({
      address: poolAddress,
      abi: POOL_SLOT0_ABI,
      functionName: 'token0',
    }) as `0x${string}`;

    const price = sqrtPriceX96ToPrice(
      sqrtPriceX96,
      tokenDecimals,
      stableDecimals,
      token0.toLowerCase() === tokenAddress.toLowerCase(),
    );

    return price;
  } catch (err) {
    console.warn(
      `[oracle] On-chain price fetch failed for ${tokenAddress} on chain ${chainId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Convert Uniswap V3 sqrtPriceX96 to a human-readable price.
 *
 * sqrtPriceX96 = sqrt(price) * 2^96
 * price = (sqrtPriceX96 / 2^96)^2 adjusted for decimal difference
 *
 * @param sqrtPriceX96 - The pool's sqrtPriceX96 value
 * @param token0Decimals - Decimals of the token we're pricing
 * @param token1Decimals - Decimals of the reference token
 * @param tokenIsToken0 - Whether the token we're pricing is token0
 * @returns Decimal price of token in terms of reference
 */
export function sqrtPriceX96ToPrice(
  sqrtPriceX96: bigint,
  token0Decimals: number,
  token1Decimals: number,
  tokenIsToken0: boolean,
): number {
  const Q96 = 2n ** 96n;

  // price = (sqrtPriceX96 / 2^96)^2
  // To avoid precision loss, compute numerator and denominator separately
  const num = sqrtPriceX96 * sqrtPriceX96;
  const denom = Q96 * Q96;

  // price represents token1/token0 in raw units
  // Adjust for decimals: multiply by 10^(token0Decimals - token1Decimals)
  const decimalAdjustment = token0Decimals - token1Decimals;

  // Convert to float carefully
  let price = Number(num) / Number(denom);

  // Apply decimal adjustment
  price *= Math.pow(10, decimalAdjustment);

  // If our token is token0, price is already token1/token0 (e.g., USDC per ETH)
  // If our token is token1, we need to invert
  if (!tokenIsToken0) {
    price = price > 0 ? 1 / price : 0;
  }

  return price;
}

// ────────────────────────────────────────────────────────────────
// Multi-source price with fallback chain (PROMPT 6)
// ────────────────────────────────────────────────────────────────

/** Known stablecoin addresses per chain (for on-chain price reference) */
const STABLE_ADDRESSES: Partial<Record<SupportedChainId, { address: `0x${string}`; decimals: number }>> = {
  1:     { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  10:    { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
  137:   { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
  8453:  { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  42161: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
  43114: { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 },
};

/**
 * Get price for a single token using the priority fallback chain:
 * 1. On-chain (Uniswap V3 pool)
 * 2. CoinGecko API
 * 3. Cached price (max 5 min old)
 *
 * @param tokenAddress - Token contract address
 * @param chainId - Chain ID
 * @param symbol - Token symbol (for CoinGecko lookup)
 * @param decimals - Token decimals (for on-chain price computation)
 */
export async function getPrice(
  tokenAddress: `0x${string}`,
  chainId: SupportedChainId,
  symbol: string,
  decimals: number,
): Promise<PriceResult> {
  const cacheKey = `${chainId}:${tokenAddress.toLowerCase()}`;

  // Stablecoins: known ~$1
  const upperSymbol = symbol.toUpperCase();
  if (['USDC', 'USDT', 'DAI', 'USDB'].includes(upperSymbol)) {
    const result: PriceResult = { usd: 1, source: 'cache', timestamp: Date.now() };
    cachePrice(cacheKey, { usd: 1, eur: 0.92, lastUpdated: Date.now() });
    return result;
  }

  // 1. Try on-chain price
  const stable = STABLE_ADDRESSES[chainId];
  if (stable) {
    const onChainPrice = await fetchOnChainPrice(
      tokenAddress,
      stable.address,
      decimals,
      stable.decimals,
      3000, // 0.3% fee tier
      chainId,
    );

    if (onChainPrice !== null && onChainPrice > 0 && isFinite(onChainPrice)) {
      const price: PriceResult = { usd: onChainPrice, source: 'onchain', timestamp: Date.now() };
      cachePrice(cacheKey, { usd: onChainPrice, eur: onChainPrice * 0.92, lastUpdated: Date.now() });

      // WBTC/BTC peg tracking
      if (isBtcToken(symbol)) {
        price.btcRatio = await computeBtcRatio(onChainPrice);
      }

      return price;
    }
  }

  // 2. Try CoinGecko
  const cgId = getCoingeckoId(symbol);
  if (cgId) {
    try {
      const cgPrice = await fetchSinglePrice(cgId);
      if (cgPrice && cgPrice.usd > 0) {
        cachePrice(cacheKey, cgPrice);
        const result: PriceResult = { usd: cgPrice.usd, source: 'coingecko', timestamp: cgPrice.lastUpdated };

        if (isBtcToken(symbol)) {
          result.btcRatio = await computeBtcRatio(cgPrice.usd);
        }

        return result;
      }
    } catch {
      // Fall through to cache
    }
  }

  // 3. Fallback: cached price
  const cached = getCachedPrice(cacheKey);
  if (cached) {
    const result: PriceResult = { usd: cached.usd, source: 'cache', timestamp: cached.lastUpdated };
    if (isBtcToken(symbol)) {
      result.btcRatio = await computeBtcRatio(cached.usd);
    }
    return result;
  }

  // Also try CoinGecko ID as cache key (from previous fetchPrices calls)
  if (cgId) {
    const cgCached = getCachedPrice(cgId);
    if (cgCached) {
      return { usd: cgCached.usd, source: 'cache', timestamp: cgCached.lastUpdated };
    }
  }

  return { usd: 0, source: 'cache', timestamp: Date.now() };
}

/**
 * Get prices for multiple tokens in batch.
 * Groups by CoinGecko ID to minimize API calls.
 *
 * @param tokens - Array of { address, symbol, decimals, chainId }
 * @param chainId - Chain ID
 * @returns Map of lowercase address → PriceResult
 */
export async function getBatchPrices(
  tokens: Array<{ address: `0x${string}`; symbol: string; decimals: number }>,
  chainId: SupportedChainId,
): Promise<Map<string, PriceResult>> {
  const results = new Map<string, PriceResult>();

  // Collect unique CoinGecko IDs needed
  const cgIdsNeeded = new Map<string, string[]>(); // cgId → [addresses]
  const stableTokens: typeof tokens = [];
  const otherTokens: typeof tokens = [];

  for (const token of tokens) {
    const upper = token.symbol.toUpperCase();
    if (['USDC', 'USDT', 'DAI', 'USDB'].includes(upper)) {
      stableTokens.push(token);
    } else {
      otherTokens.push(token);
      const cgId = getCoingeckoId(token.symbol);
      if (cgId) {
        const existing = cgIdsNeeded.get(cgId) ?? [];
        existing.push(token.address.toLowerCase());
        cgIdsNeeded.set(cgId, existing);
      }
    }
  }

  // Stablecoins: instant
  for (const token of stableTokens) {
    results.set(token.address.toLowerCase(), {
      usd: 1,
      source: 'cache',
      timestamp: Date.now(),
    });
  }

  // Batch fetch from CoinGecko
  const uniqueCgIds = Array.from(cgIdsNeeded.keys());
  let cgPrices: PriceMap = {};

  if (uniqueCgIds.length > 0) {
    try {
      cgPrices = await fetchPrices(uniqueCgIds);
      // Cache all fetched prices
      for (const [cgId, price] of Object.entries(cgPrices)) {
        cachePrice(cgId, price);
      }
    } catch {
      // Use cached prices below
    }
  }

  // Map CoinGecko results + cache fallback for non-stables
  for (const token of otherTokens) {
    const addrKey = token.address.toLowerCase();
    const cacheKey = `${chainId}:${addrKey}`;
    const cgId = getCoingeckoId(token.symbol);

    // Try CoinGecko result
    if (cgId && cgPrices[cgId]?.usd > 0) {
      const p = cgPrices[cgId];
      cachePrice(cacheKey, p);
      const result: PriceResult = { usd: p.usd, source: 'coingecko', timestamp: p.lastUpdated };
      if (isBtcToken(token.symbol)) {
        result.btcRatio = computeBtcRatioSync(p.usd, cgPrices['bitcoin']?.usd);
      }
      results.set(addrKey, result);
      continue;
    }

    // Try chain-specific cache
    const cached = getCachedPrice(cacheKey);
    if (cached) {
      results.set(addrKey, { usd: cached.usd, source: 'cache', timestamp: cached.lastUpdated });
      continue;
    }

    // Try CoinGecko ID cache
    if (cgId) {
      const cgCached = getCachedPrice(cgId);
      if (cgCached) {
        results.set(addrKey, { usd: cgCached.usd, source: 'cache', timestamp: cgCached.lastUpdated });
        continue;
      }
    }

    // No price available
    results.set(addrKey, { usd: 0, source: 'cache', timestamp: Date.now() });
  }

  return results;
}

// ────────────────────────────────────────────────────────────────
// WBTC/BTC peg tracking
// ────────────────────────────────────────────────────────────────

/** Check if a token symbol represents a BTC-pegged asset */
function isBtcToken(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  return ['WBTC', 'CBBTC', 'BTCB'].includes(upper);
}

/**
 * Compute WBTC/BTC peg ratio using cached BTC price.
 * Returns ratio (1.0 = perfect peg).
 */
async function computeBtcRatio(wbtcUsd: number): Promise<number | undefined> {
  if (wbtcUsd <= 0) return undefined;

  // Try cached BTC price first
  const btcCached = getCachedPrice('bitcoin');
  if (btcCached && btcCached.usd > 0) {
    return wbtcUsd / btcCached.usd;
  }

  // Fetch BTC price
  try {
    const btcPrice = await fetchSinglePrice('bitcoin');
    if (btcPrice && btcPrice.usd > 0) {
      return wbtcUsd / btcPrice.usd;
    }
  } catch {
    // Can't compute ratio
  }

  return undefined;
}

/**
 * Synchronous BTC ratio computation (when BTC price is already available).
 * @internal
 */
function computeBtcRatioSync(wbtcUsd: number, btcUsd?: number): number | undefined {
  if (!btcUsd || btcUsd <= 0 || wbtcUsd <= 0) return undefined;
  return wbtcUsd / btcUsd;
}

/**
 * Build a fallback PriceMap from cached entries when rate limited.
 * @internal
 */
function buildCacheFallback(ids: string[]): PriceMap {
  const result: PriceMap = {};
  for (const id of ids) {
    const cached = getCachedPrice(id);
    if (cached) result[id] = cached;
  }
  return result;
}
