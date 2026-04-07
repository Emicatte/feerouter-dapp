/**
 * src/types/token.ts — Token type definitions
 *
 * Core token interfaces used across the wallet connector:
 * balances, metadata, and display formatting.
 */

/** ERC-20 or native token descriptor */
export interface Token {
  address: `0x${string}`;
  chainId: number;
  decimals: number;
  symbol: string;
  name: string;
  logoURI?: string;
  tags?: string[];
  isNative?: boolean;
  isWrapped?: boolean;
  wrappedAddress?: `0x${string}`;
}

/** Token with on-chain balance and USD valuation */
export interface TokenBalance extends Token {
  balance: bigint;
  formattedBalance: string;
  usdValue: number | null;
}

/** Token list metadata (e.g. Uniswap default list) */
export interface TokenList {
  name: string;
  version: { major: number; minor: number; patch: number };
  tokens: Token[];
  timestamp: string;
  logoURI?: string;
}

/** Token amount with parsed + raw representation */
export interface TokenAmount {
  token: Token;
  raw: bigint;
  formatted: string;
  usdValue: number | null;
}

/** Bridge origin info for wrapped BTC variants */
export interface WBTCBridgeInfo {
  /** Name of the bridge protocol */
  bridgeName: string;
  /** Type: native mint (BitGo) vs bridged from another chain */
  bridgeType: 'native' | 'bridged';
  /** Source chain for bridged variants (e.g. Ethereum for Arbitrum WBTC) */
  sourceChainId?: number;
  /** Whether the token has sufficient on-chain liquidity */
  lowLiquidity?: boolean;
}

/** Result from on-chain token metadata resolution */
export interface ResolvedTokenMeta {
  name: string;
  symbol: string;
  decimals: number;
}

/** Token search match with relevance score */
export interface TokenSearchResult {
  token: Token;
  /** Match quality: 'exact' for address/symbol match, 'partial' for substring */
  matchType: 'exact' | 'partial';
}

/** CoinGecko ID mapping for price lookups */
export interface TokenPriceId {
  /** Token symbol (uppercase) */
  symbol: string;
  /** CoinGecko API ID */
  coingeckoId: string;
}
