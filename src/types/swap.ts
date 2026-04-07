/**
 * src/types/swap.ts — Swap type definitions
 *
 * Describes quotes, routes, pool info, and swap parameters
 * for Uniswap V3 integration.
 */

import type { Token } from './token';

/** Uniswap V3 pool snapshot */
export interface PoolInfo {
  address: `0x${string}`;
  fee: number;
  liquidity: bigint;
  sqrtPriceX96: bigint;
  tick: number;
}

/** Swap route through one or more pools */
export interface SwapRoute {
  path: Token[];
  pools: PoolInfo[];
  type: 'EXACT_INPUT' | 'EXACT_OUTPUT';
}

/** Full swap quote returned by the quoter */
export interface SwapQuote {
  inputToken: Token;
  outputToken: Token;
  inputAmount: bigint;
  outputAmount: bigint;
  executionPrice: string;
  priceImpact: number;
  route: SwapRoute;
  gasEstimate: bigint;
  fee: { amount: bigint; percentage: number };
  slippageTolerance: number;
  deadline: number;
  minimumReceived: bigint;
}

/** Parameters for executing a swap */
export interface SwapParams {
  quote: SwapQuote;
  recipient: `0x${string}`;
  slippageTolerance: number;
  deadline: number;
}

/** Slippage preset or custom value */
export type SlippagePreset = 0.1 | 0.5 | 1.0;

/** Swap direction */
export type SwapDirection = 'EXACT_INPUT' | 'EXACT_OUTPUT';
