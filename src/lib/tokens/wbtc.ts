/**
 * src/lib/tokens/wbtc.ts — WBTC-specific logic
 *
 * Bridge awareness, wrapping detection, decimal helpers,
 * and WBTC-specific utilities across all supported chains.
 */

import { formatUnits, parseUnits } from 'viem';
import type { Token } from '../../types/token';
import type { WBTCBridgeInfo } from '../../types/token';
import { DEFAULT_TOKENS } from '../../config/tokens';

/** WBTC uses 8 decimals on every chain */
export const WBTC_DECIMALS = 8;

/** Known WBTC / BTC-wrapped contract addresses per chain */
export const WBTC_ADDRESSES: Record<number, `0x${string}`> = {
  1:     '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  10:    '0x68f180fcCe6836688e9084f035309E29Bf0A2095',
  137:   '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
  42161: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  43114: '0x50b7545627a5162F82A992c33b87aDc75187B218',
};

/** Known cbBTC contract addresses per chain */
export const CBBTC_ADDRESSES: Record<number, `0x${string}`> = {
  8453: '0xcbB7C0000AB88B473b1f5aFd9ef808440eed33Bf',
};

/** Known BTCB (BNB Chain) address */
export const BTCB_ADDRESSES: Record<number, `0x${string}`> = {
  56: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
};

/** Bridge info for every WBTC/BTC variant per chain */
const BRIDGE_INFO: Record<number, WBTCBridgeInfo> = {
  1: {
    bridgeName: 'BitGo',
    bridgeType: 'native',
  },
  10: {
    bridgeName: 'Optimism Bridge',
    bridgeType: 'bridged',
    sourceChainId: 1,
  },
  56: {
    bridgeName: 'Binance Bridge',
    bridgeType: 'bridged',
    sourceChainId: 1,
  },
  137: {
    bridgeName: 'Polygon PoS Bridge',
    bridgeType: 'bridged',
    sourceChainId: 1,
  },
  8453: {
    bridgeName: 'Coinbase',
    bridgeType: 'native',
  },
  42161: {
    bridgeName: 'Arbitrum Bridge',
    bridgeType: 'bridged',
    sourceChainId: 1,
  },
  43114: {
    bridgeName: 'Avalanche Bridge',
    bridgeType: 'bridged',
    sourceChainId: 1,
    lowLiquidity: true,
  },
};

/**
 * Type guard: check if a token is a wrapped BTC variant (WBTC, cbBTC, BTCB).
 * @param token - Token to check
 */
export function isWBTC(token: Token): boolean {
  return token.tags?.includes('btc') ?? false;
}

/**
 * Check if a token is a wrapped BTC variant (alias for backward compat).
 * @param token - Token to check
 */
export function isBtcWrapped(token: Token): boolean {
  return isWBTC(token);
}

/**
 * Get the BTC-wrapped token for a specific chain from default token lists.
 * Returns the full Token object, or null if no BTC variant exists on that chain.
 * @param chainId - Target chain
 */
export function getWBTCForChain(chainId: number): Token | null {
  const tokens = DEFAULT_TOKENS[chainId as keyof typeof DEFAULT_TOKENS];
  if (!tokens) return null;
  return tokens.find((t) => t.tags?.includes('btc')) ?? null;
}

/**
 * Get the BTC-wrapped token address for a specific chain.
 * Returns WBTC on Ethereum/Arbitrum/Optimism/Polygon/Avalanche, cbBTC on Base, BTCB on BNB.
 * @param chainId - Target chain
 */
export function getBtcTokenAddress(chainId: number): `0x${string}` | null {
  return (
    WBTC_ADDRESSES[chainId] ??
    CBBTC_ADDRESSES[chainId] ??
    BTCB_ADDRESSES[chainId] ??
    null
  );
}

/**
 * Get bridge/origin info for the BTC variant on a chain.
 * @param chainId - Target chain
 */
export function getWBTCBridgeInfo(chainId: number): WBTCBridgeInfo | null {
  return BRIDGE_INFO[chainId] ?? null;
}

/**
 * Format a WBTC raw amount (8 decimals) to a human-readable string.
 * Never assumes 18 decimals — always uses the token's actual decimals.
 * @param amount - Raw bigint amount
 * @param decimals - Token decimals (defaults to 8 for WBTC)
 */
export function formatWBTCAmount(amount: bigint, decimals: number = WBTC_DECIMALS): string {
  return formatUnits(amount, decimals);
}

/**
 * Parse a human-readable WBTC amount string to raw bigint.
 * @param amount - Human-readable string (e.g. "0.5")
 * @param decimals - Token decimals (defaults to 8 for WBTC)
 */
export function parseWBTCAmount(amount: string, decimals: number = WBTC_DECIMALS): bigint {
  return parseUnits(amount, decimals);
}

/**
 * Convert a generic token amount between different decimal precisions.
 * Useful for converting between 18-decimal and 8-decimal amounts.
 * @param amount - Raw bigint in source decimals
 * @param fromDecimals - Source decimal precision
 * @param toDecimals - Target decimal precision
 */
export function convertDecimals(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number,
): bigint {
  if (fromDecimals === toDecimals) return amount;
  if (fromDecimals > toDecimals) {
    return amount / 10n ** BigInt(fromDecimals - toDecimals);
  }
  return amount * 10n ** BigInt(toDecimals - fromDecimals);
}

/**
 * Get all WBTC/BTC-related tokens across all chains.
 */
export function getWbtcTokens(): Token[] {
  return Object.values(DEFAULT_TOKENS)
    .flat()
    .filter((t) => t.tags?.includes('btc'));
}

/**
 * Check if a WBTC variant on a given chain has low liquidity warning.
 * @param chainId - Target chain
 */
export function hasLowLiquidity(chainId: number): boolean {
  return BRIDGE_INFO[chainId]?.lowLiquidity ?? false;
}
