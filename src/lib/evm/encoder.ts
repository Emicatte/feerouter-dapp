/**
 * src/lib/evm/encoder.ts — ABI encoding helpers
 *
 * Utilities for encoding Uniswap V3 swap paths and function calls.
 */

import { encodePacked, type Hex } from 'viem';

/** Uniswap V3 fee tiers */
export const FEE_TIERS = [100, 500, 3000, 10000] as const;
export type FeeTier = (typeof FEE_TIERS)[number];

/**
 * Encode a Uniswap V3 multi-hop path.
 * Format: token0 + fee01 + token1 + fee12 + token2 ...
 * @param tokens - Array of token addresses in order
 * @param fees - Array of fee tiers between each pair
 */
export function encodeV3Path(
  tokens: `0x${string}`[],
  fees: FeeTier[],
): Hex {
  if (tokens.length !== fees.length + 1) {
    throw new Error(`Path encoding: expected ${fees.length + 1} tokens for ${fees.length} fees`);
  }

  const types: ('address' | 'uint24')[] = [];
  const values: (`0x${string}` | number)[] = [];

  for (let i = 0; i < tokens.length; i++) {
    types.push('address');
    values.push(tokens[i]);
    if (i < fees.length) {
      types.push('uint24');
      values.push(fees[i]);
    }
  }

  return encodePacked(types, values);
}

/**
 * Calculate the deadline timestamp for a swap.
 * @param minutes - Minutes from now
 */
export function swapDeadline(minutes: number = 20): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
}
