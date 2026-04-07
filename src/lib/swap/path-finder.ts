/**
 * src/lib/swap/path-finder.ts — Optimal route calculation
 *
 * Finds the best swap path across fee tiers and intermediate tokens.
 * Features: direct + 2-hop routes, parallel quote fetching via
 * Promise.allSettled, 5-second timeout, WETH/USDC/USDT/WBTC/DAI intermediaries.
 */

import type { PublicClient } from 'viem';
import type { Token } from '../../types/token';
import type { SwapRoute, SwapQuote, PoolInfo } from '../../types/swap';
import type { SupportedChainId } from '../../types/chain';
import { FEE_TIERS, encodeV3Path, type FeeTier } from '../evm/encoder';
import { CONTRACT_ADDRESSES, NATIVE_ADDRESS } from '../../constants/addresses';
import { quoteSingleHop, quoteMultiHop, buildQuoteFromRoute } from './quoter';
import { getDefaultTokens } from '../../config/tokens';

/** Candidate route with estimated output */
export interface RouteCandidate {
  route: SwapRoute;
  estimatedOutput: bigint;
  feeTier: FeeTier;
  gasEstimate: bigint;
}

/** Maximum time to spend finding the best route (ms) */
const ROUTE_TIMEOUT = 5_000;

/** Fee tier subsets for 2-hop routes (limit combinatorial explosion) */
const TWO_HOP_FEE_TIERS: FeeTier[] = [500, 3000, 10000];

/** Symbols of tokens used as intermediaries in 2-hop routes */
const INTERMEDIARY_SYMBOLS = ['WETH', 'USDC', 'USDT', 'WBTC', 'DAI'] as const;

/**
 * Resolve the on-chain address for a token, replacing native placeholder with WETH.
 * @internal
 */
function resolveAddress(token: Token, chainId: SupportedChainId): `0x${string}` {
  if (token.isNative || token.address.toLowerCase() === NATIVE_ADDRESS.toLowerCase()) {
    return CONTRACT_ADDRESSES[chainId].weth;
  }
  return token.address;
}

/**
 * Get intermediary tokens available on a chain (WETH, USDC, USDT, WBTC, DAI).
 * Excludes tokens that are the same as tokenIn or tokenOut.
 * @internal
 */
function getIntermediaries(
  chainId: SupportedChainId,
  tokenInAddr: `0x${string}`,
  tokenOutAddr: `0x${string}`,
): Token[] {
  const defaults = getDefaultTokens(chainId);
  const inLower = tokenInAddr.toLowerCase();
  const outLower = tokenOutAddr.toLowerCase();

  return defaults.filter((t) => {
    if (!INTERMEDIARY_SYMBOLS.includes(t.symbol as typeof INTERMEDIARY_SYMBOLS[number])) {
      // Also include wrapped natives (WBNB, WMATIC, WAVAX, etc.) as they serve the WETH role
      if (!t.isWrapped && !t.symbol.startsWith('W')) return false;
    }
    const addr = resolveAddress(t, chainId).toLowerCase();
    return addr !== inLower && addr !== outLower;
  });
}

/**
 * Generate all direct route candidates (one per fee tier).
 * @internal
 */
async function findDirectRoutes(
  client: PublicClient,
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
  chainId: SupportedChainId,
): Promise<RouteCandidate[]> {
  const inAddr = resolveAddress(tokenIn, chainId);
  const outAddr = resolveAddress(tokenOut, chainId);
  const candidates: RouteCandidate[] = [];

  const results = await Promise.allSettled(
    FEE_TIERS.map((fee) =>
      quoteSingleHop(client, inAddr, outAddr, fee, amountIn, chainId),
    ),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== 'fulfilled' || !r.value) continue;

    const pool: PoolInfo = {
      address: '0x0000000000000000000000000000000000000000',
      fee: FEE_TIERS[i],
      liquidity: 0n,
      sqrtPriceX96: r.value.sqrtPriceX96After,
      tick: 0,
    };

    candidates.push({
      route: {
        path: [tokenIn, tokenOut],
        pools: [pool],
        type: 'EXACT_INPUT',
      },
      estimatedOutput: r.value.amountOut,
      feeTier: FEE_TIERS[i],
      gasEstimate: r.value.gasEstimate,
    });
  }

  return candidates;
}

/**
 * Generate 2-hop route candidates via intermediary tokens.
 * For each intermediary, tries fee tier combinations on both hops.
 * @internal
 */
async function findTwoHopRoutes(
  client: PublicClient,
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
  chainId: SupportedChainId,
): Promise<RouteCandidate[]> {
  const inAddr = resolveAddress(tokenIn, chainId);
  const outAddr = resolveAddress(tokenOut, chainId);
  const intermediaries = getIntermediaries(chainId, inAddr, outAddr);
  const candidates: RouteCandidate[] = [];

  // Build all 2-hop quote requests
  type TwoHopRequest = {
    intermediate: Token;
    feeA: FeeTier;
    feeB: FeeTier;
    path: `0x${string}`;
  };

  const requests: TwoHopRequest[] = [];

  for (const mid of intermediaries) {
    const midAddr = resolveAddress(mid, chainId);

    for (const feeA of TWO_HOP_FEE_TIERS) {
      for (const feeB of TWO_HOP_FEE_TIERS) {
        const path = encodeV3Path([inAddr, midAddr, outAddr], [feeA, feeB]);
        requests.push({ intermediate: mid, feeA, feeB, path });
      }
    }
  }

  // Quote all 2-hop paths in parallel
  const results = await Promise.allSettled(
    requests.map((req) =>
      quoteMultiHop(client, req.path, amountIn, chainId),
    ),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== 'fulfilled' || !r.value) continue;

    const req = requests[i];
    const poolA: PoolInfo = {
      address: '0x0000000000000000000000000000000000000000',
      fee: req.feeA,
      liquidity: 0n,
      sqrtPriceX96: r.value.sqrtPriceX96AfterList[0] ?? 0n,
      tick: 0,
    };
    const poolB: PoolInfo = {
      address: '0x0000000000000000000000000000000000000000',
      fee: req.feeB,
      liquidity: 0n,
      sqrtPriceX96: r.value.sqrtPriceX96AfterList[1] ?? 0n,
      tick: 0,
    };

    candidates.push({
      route: {
        path: [tokenIn, req.intermediate, tokenOut],
        pools: [poolA, poolB],
        type: 'EXACT_INPUT',
      },
      estimatedOutput: r.value.amountOut,
      feeTier: req.feeA, // Primary fee tier
      gasEstimate: r.value.gasEstimate,
    });
  }

  return candidates;
}

/**
 * Find the optimal swap path between two tokens.
 * Evaluates direct paths and multi-hop routes through common intermediaries.
 * Returns all viable candidates sorted by output (best first), or empty if no route.
 * Enforces a 5-second timeout — returns whatever has been found by then.
 *
 * @param tokenIn - Source token
 * @param tokenOut - Destination token
 * @param amountIn - Input amount
 * @param chainId - Target chain
 * @param client - Viem public client
 */
export async function findOptimalPath(
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
  chainId: SupportedChainId,
  client?: PublicClient,
): Promise<RouteCandidate[]> {
  if (!client) return [];
  if (amountIn === 0n) return [];

  // Race route discovery against timeout
  const routePromise = Promise.allSettled([
    findDirectRoutes(client, tokenIn, tokenOut, amountIn, chainId),
    findTwoHopRoutes(client, tokenIn, tokenOut, amountIn, chainId),
  ]);

  const timeoutPromise = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), ROUTE_TIMEOUT),
  );

  const race = await Promise.race([routePromise, timeoutPromise]);

  let allCandidates: RouteCandidate[] = [];

  if (race === 'timeout') {
    // Timeout — return whatever direct routes we can get synchronously
    return [];
  }

  for (const result of race) {
    if (result.status === 'fulfilled') {
      allCandidates = allCandidates.concat(result.value);
    }
  }

  // Sort by output amount descending (best first)
  allCandidates.sort((a, b) => {
    if (b.estimatedOutput > a.estimatedOutput) return 1;
    if (b.estimatedOutput < a.estimatedOutput) return -1;
    // Prefer lower gas on tie
    if (a.gasEstimate < b.gasEstimate) return -1;
    if (a.gasEstimate > b.gasEstimate) return 1;
    return 0;
  });

  return allCandidates;
}

/**
 * Find the single best route and return a fully-built SwapQuote.
 * Convenience wrapper around findOptimalPath + buildQuoteFromRoute.
 * Returns null if no viable route is found.
 *
 * @param client - Viem public client
 * @param tokenIn - Source token
 * @param tokenOut - Destination token
 * @param amountIn - Input amount (raw bigint, in token's decimals)
 * @param chainId - Target chain
 * @param slippage - Slippage tolerance percentage (default 0.5)
 * @param deadline - Deadline in minutes (default 20)
 */
export async function findBestRoute(
  client: PublicClient,
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
  chainId: SupportedChainId,
  slippage?: number,
  deadline?: number,
): Promise<SwapQuote | null> {
  const candidates = await findOptimalPath(tokenIn, tokenOut, amountIn, chainId, client);
  if (candidates.length === 0) return null;

  const best = candidates[0];
  return buildQuoteFromRoute(
    tokenIn,
    tokenOut,
    amountIn,
    best.estimatedOutput,
    best.gasEstimate,
    best.route,
    slippage,
    deadline,
  );
}
