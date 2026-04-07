/**
 * src/lib/swap/quoter.ts — Quote fetching logic
 *
 * Fetches swap quotes from Uniswap V3 QuoterV2 contract.
 * Features: single-hop and multi-hop quotes, 10s TTL cache,
 * retry with exponential backoff, graceful null on missing pools.
 */

import type { PublicClient } from 'viem';
import { formatUnits } from 'viem';
import type { Token } from '../../types/token';
import type { SwapQuote, SwapDirection, SwapRoute, PoolInfo } from '../../types/swap';
import type { SupportedChainId } from '../../types/chain';
import { UNISWAP_V3_QUOTER_ABI } from '../../constants/abis/uniswapV3Quoter';
import { CONTRACT_ADDRESSES } from '../../constants/addresses';
import { encodeV3Path, type FeeTier } from '../evm/encoder';
import { calculateMinimumReceived, calculatePriceImpact, DEFAULT_SLIPPAGE } from './slippage';

/** Parameters for fetching a swap quote */
export interface QuoteRequest {
  tokenIn: Token;
  tokenOut: Token;
  amount: bigint;
  direction: SwapDirection;
  chainId: SupportedChainId;
}

/** Raw result from a single-hop QuoterV2 call */
export interface SingleHopQuoteResult {
  amountOut: bigint;
  sqrtPriceX96After: bigint;
  initializedTicksCrossed: number;
  gasEstimate: bigint;
}

/** Raw result from a multi-hop QuoterV2 call */
export interface MultiHopQuoteResult {
  amountOut: bigint;
  sqrtPriceX96AfterList: bigint[];
  initializedTicksCrossedList: number[];
  gasEstimate: bigint;
}

/** Quote cache entry */
interface CachedQuote {
  result: SingleHopQuoteResult | null;
  timestamp: number;
}

/** Cache TTL: 10 seconds */
const QUOTE_CACHE_TTL = 10_000;

/** Maximum retry attempts for RPC failures */
const MAX_RETRIES = 3;

/** Base delay between retries (ms) — doubles on each retry */
const BASE_RETRY_DELAY = 500;

/** In-memory quote cache keyed by "chainId:tokenIn:tokenOut:fee:amount" */
const quoteCache = new Map<string, CachedQuote>();

/**
 * Build cache key for single-hop quotes.
 * @internal
 */
function quoteCacheKey(
  chainId: number,
  tokenIn: string,
  tokenOut: string,
  fee: number,
  amount: bigint,
): string {
  return `${chainId}:${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}:${fee}:${amount}`;
}

/**
 * Sleep for a given number of milliseconds.
 * @internal
 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Execute a function with retry and exponential backoff.
 * @internal
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries - 1) {
        await sleep(BASE_RETRY_DELAY * 2 ** attempt);
      }
    }
  }
  throw lastError;
}

/**
 * Fetch a single-hop quote from QuoterV2.quoteExactInputSingle.
 * Returns null if the pool does not exist or the call reverts.
 * @param client - Viem public client
 * @param tokenIn - Input token address
 * @param tokenOut - Output token address
 * @param fee - Pool fee tier
 * @param amountIn - Input amount (raw bigint)
 * @param chainId - Target chain
 */
export async function quoteSingleHop(
  client: PublicClient,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  fee: FeeTier,
  amountIn: bigint,
  chainId: SupportedChainId,
): Promise<SingleHopQuoteResult | null> {
  const key = quoteCacheKey(chainId, tokenIn, tokenOut, fee, amountIn);
  const cached = quoteCache.get(key);
  if (cached && Date.now() - cached.timestamp < QUOTE_CACHE_TTL) {
    return cached.result;
  }

  const quoterAddress = CONTRACT_ADDRESSES[chainId].uniswapV3Quoter;

  try {
    const result = await withRetry(() =>
      client.simulateContract({
        address: quoterAddress,
        abi: UNISWAP_V3_QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            tokenIn,
            tokenOut,
            amountIn,
            fee,
            sqrtPriceLimitX96: 0n,
          },
        ],
      }),
    );

    const [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] =
      result.result as [bigint, bigint, number, bigint];

    const quoteResult: SingleHopQuoteResult = {
      amountOut,
      sqrtPriceX96After,
      initializedTicksCrossed,
      gasEstimate,
    };

    quoteCache.set(key, { result: quoteResult, timestamp: Date.now() });
    return quoteResult;
  } catch {
    // Pool doesn't exist or other revert — cache the null result too
    quoteCache.set(key, { result: null, timestamp: Date.now() });
    return null;
  }
}

/**
 * Fetch a multi-hop quote from QuoterV2.quoteExactInput.
 * Returns null if any pool in the path does not exist.
 * @param client - Viem public client
 * @param path - Encoded V3 path (token + fee + token + ...)
 * @param amountIn - Input amount (raw bigint)
 * @param chainId - Target chain
 */
export async function quoteMultiHop(
  client: PublicClient,
  path: `0x${string}`,
  amountIn: bigint,
  chainId: SupportedChainId,
): Promise<MultiHopQuoteResult | null> {
  const quoterAddress = CONTRACT_ADDRESSES[chainId].uniswapV3Quoter;

  try {
    const result = await withRetry(() =>
      client.simulateContract({
        address: quoterAddress,
        abi: UNISWAP_V3_QUOTER_ABI,
        functionName: 'quoteExactInput',
        args: [path, amountIn],
      }),
    );

    const [amountOut, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate] =
      result.result as [bigint, bigint[], number[], bigint];

    return {
      amountOut,
      sqrtPriceX96AfterList,
      initializedTicksCrossedList,
      gasEstimate,
    };
  } catch {
    return null;
  }
}

/**
 * Build a full SwapQuote from a route candidate and its quote result.
 * @internal
 */
function buildSwapQuote(
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
  amountOut: bigint,
  gasEstimate: bigint,
  route: SwapRoute,
  slippage: number,
  deadline: number,
): SwapQuote {
  const inFormatted = Number(formatUnits(amountIn, tokenIn.decimals));
  const outFormatted = Number(formatUnits(amountOut, tokenOut.decimals));

  const executionPrice = inFormatted > 0 ? outFormatted / inFormatted : 0;

  // Price impact is relative to execution price vs a "fair" price
  // For a simple estimate, we use 0 (actual market price would come from oracle)
  const priceImpact = 0;

  const totalFeeBps = route.pools.reduce((sum, p) => sum + p.fee, 0);
  const feePercentage = totalFeeBps / 10_000;
  const feeAmount = (amountIn * BigInt(totalFeeBps)) / 10_000n;

  const minimumReceived = calculateMinimumReceived(amountOut, slippage);

  return {
    inputToken: tokenIn,
    outputToken: tokenOut,
    inputAmount: amountIn,
    outputAmount: amountOut,
    executionPrice: executionPrice.toString(),
    priceImpact,
    route,
    gasEstimate,
    fee: { amount: feeAmount, percentage: feePercentage },
    slippageTolerance: slippage,
    deadline,
    minimumReceived,
  };
}

/**
 * Fetch a swap quote from the Uniswap V3 Quoter.
 * Tries single-hop across all fee tiers, picks the best output.
 * @param client - Viem public client
 * @param request - Quote request parameters
 */
export async function fetchQuote(
  client: PublicClient,
  request: QuoteRequest,
): Promise<SwapQuote | null> {
  const { tokenIn, tokenOut, amount, chainId } = request;

  const inAddress = tokenIn.isNative
    ? CONTRACT_ADDRESSES[chainId].weth
    : tokenIn.address;
  const outAddress = tokenOut.isNative
    ? CONTRACT_ADDRESSES[chainId].weth
    : tokenOut.address;

  // Try all fee tiers in parallel
  const feeTiers: FeeTier[] = [100, 500, 3000, 10000];
  const results = await Promise.allSettled(
    feeTiers.map((fee) =>
      quoteSingleHop(client, inAddress, outAddress, fee, amount, chainId),
    ),
  );

  let bestResult: SingleHopQuoteResult | null = null;
  let bestFee: FeeTier = 3000;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== 'fulfilled' || !r.value) continue;
    if (!bestResult || r.value.amountOut > bestResult.amountOut) {
      bestResult = r.value;
      bestFee = feeTiers[i];
    }
  }

  if (!bestResult) return null;

  const pool: PoolInfo = {
    address: '0x0000000000000000000000000000000000000000',
    fee: bestFee,
    liquidity: 0n,
    sqrtPriceX96: bestResult.sqrtPriceX96After,
    tick: 0,
  };

  const route: SwapRoute = {
    path: [tokenIn, tokenOut],
    pools: [pool],
    type: 'EXACT_INPUT',
  };

  return buildSwapQuote(
    tokenIn,
    tokenOut,
    amount,
    bestResult.amountOut,
    bestResult.gasEstimate,
    route,
    DEFAULT_SLIPPAGE,
    20,
  );
}

/**
 * Build a SwapQuote from pre-computed route data (used by path-finder).
 * @param tokenIn - Input token
 * @param tokenOut - Output token
 * @param amountIn - Raw input amount
 * @param amountOut - Raw output amount from quote
 * @param gasEstimate - Gas estimate from quoter
 * @param route - Pre-built swap route
 * @param slippage - Slippage tolerance percentage
 * @param deadline - Deadline in minutes
 */
export function buildQuoteFromRoute(
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
  amountOut: bigint,
  gasEstimate: bigint,
  route: SwapRoute,
  slippage: number = DEFAULT_SLIPPAGE,
  deadline: number = 20,
): SwapQuote {
  return buildSwapQuote(
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    gasEstimate,
    route,
    slippage,
    deadline,
  );
}

/**
 * Clear the entire quote cache, or entries for a specific chain.
 * @param chainId - Optional chain to clear (clears all if omitted)
 */
export function clearQuoteCache(chainId?: number): void {
  if (chainId === undefined) {
    quoteCache.clear();
    return;
  }
  const prefix = `${chainId}:`;
  for (const key of quoteCache.keys()) {
    if (key.startsWith(prefix)) {
      quoteCache.delete(key);
    }
  }
}
