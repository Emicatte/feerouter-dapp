/**
 * app/tokens/tokenRegistry.ts — Unified Multi-Chain Token Registry
 *
 * SINGLE SOURCE OF TRUTH per tutti i token supportati da RSend.
 * Il backend (rpagos-backend/app/tokens/registry.py) rispecchia questi dati.
 *
 * Chains supportate:
 *   8453   — Base Mainnet
 *   84532  — Base Sepolia (testnet)
 *   1      — Ethereum Mainnet
 *   42161  — Arbitrum One
 */

export interface TokenInfo {
  symbol: string
  name: string
  decimals: number
  address: string | null       // null = nativo (ETH)
  chainId: number
  isNative: boolean
  logoUrl: string              // icona locale /tokens/*.svg
  coingeckoId: string          // per price feed
  minAmount: string            // importo minimo in unità human (es. "0.001")
  batchDistributorAddress?: string  // contratto RSend per batch distribution
}

export const SUPPORTED_CHAINS = {
  8453:  { name: 'Base',          nativeCurrency: 'ETH', explorerUrl: 'https://basescan.org',         iconUrl: '/chains/base.svg' },
  84532: { name: 'Base Sepolia',  nativeCurrency: 'ETH', explorerUrl: 'https://sepolia.basescan.org', iconUrl: '/chains/base.svg' },
  1:     { name: 'Ethereum',      nativeCurrency: 'ETH', explorerUrl: 'https://etherscan.io',         iconUrl: '/chains/ethereum.svg' },
  42161: { name: 'Arbitrum One',  nativeCurrency: 'ETH', explorerUrl: 'https://arbiscan.io',          iconUrl: '/chains/arbitrum.svg' },
} as const

export type ChainId = keyof typeof SUPPORTED_CHAINS

export const TOKEN_LIST: TokenInfo[] = [
  // ═══════════ BASE MAINNET (8453) ═══════════
  {
    symbol: 'ETH', name: 'Ether', decimals: 18,
    address: null, chainId: 8453, isNative: true,
    logoUrl: '/tokens/eth.svg', coingeckoId: 'ethereum',
    minAmount: '0.0001',
    batchDistributorAddress: '0x481062Ba5843BbF8BcC7781EF84D42e49D0D77c3',
  },
  {
    symbol: 'USDC', name: 'USD Coin', decimals: 6,
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', chainId: 8453, isNative: false,
    logoUrl: '/tokens/usdc.svg', coingeckoId: 'usd-coin',
    minAmount: '0.01',
    batchDistributorAddress: '0x481062Ba5843BbF8BcC7781EF84D42e49D0D77c3',
  },
  {
    symbol: 'USDT', name: 'Tether USD', decimals: 6,
    address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', chainId: 8453, isNative: false,
    logoUrl: '/tokens/usdt.svg', coingeckoId: 'tether',
    minAmount: '0.01',
  },
  {
    symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18,
    address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', chainId: 8453, isNative: false,
    logoUrl: '/tokens/dai.svg', coingeckoId: 'dai',
    minAmount: '0.01',
  },
  {
    symbol: 'WETH', name: 'Wrapped Ether', decimals: 18,
    address: '0x4200000000000000000000000000000000000006', chainId: 8453, isNative: false,
    logoUrl: '/tokens/weth.svg', coingeckoId: 'weth',
    minAmount: '0.0001',
  },
  {
    symbol: 'cbBTC', name: 'Coinbase BTC', decimals: 8,
    address: '0xcbB7C0000AB88B473b1f5aFd9ef808440eed33Bf', chainId: 8453, isNative: false,
    logoUrl: '/tokens/btc.svg', coingeckoId: 'bitcoin',
    minAmount: '0.00001',
  },

  // ═══════════ BASE SEPOLIA (84532) ═══════════
  {
    symbol: 'ETH', name: 'Ether (Sepolia)', decimals: 18,
    address: null, chainId: 84532, isNative: true,
    logoUrl: '/tokens/eth.svg', coingeckoId: 'ethereum',
    minAmount: '0.0001',
    batchDistributorAddress: '0x481062Ba5843BbF8BcC7781EF84D42e49D0D77c3',
  },
  {
    symbol: 'USDC', name: 'USDC (Sepolia)', decimals: 6,
    address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', chainId: 84532, isNative: false,
    logoUrl: '/tokens/usdc.svg', coingeckoId: 'usd-coin',
    minAmount: '0.01',
  },

  // ═══════════ ETHEREUM MAINNET (1) ═══════════
  {
    symbol: 'ETH', name: 'Ether', decimals: 18,
    address: null, chainId: 1, isNative: true,
    logoUrl: '/tokens/eth.svg', coingeckoId: 'ethereum',
    minAmount: '0.001',
  },
  {
    symbol: 'USDC', name: 'USD Coin', decimals: 6,
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chainId: 1, isNative: false,
    logoUrl: '/tokens/usdc.svg', coingeckoId: 'usd-coin',
    minAmount: '0.01',
  },
  {
    symbol: 'USDT', name: 'Tether USD', decimals: 6,
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', chainId: 1, isNative: false,
    logoUrl: '/tokens/usdt.svg', coingeckoId: 'tether',
    minAmount: '0.01',
  },

  // ═══════════ ARBITRUM ONE (42161) ═══════════
  {
    symbol: 'ETH', name: 'Ether', decimals: 18,
    address: null, chainId: 42161, isNative: true,
    logoUrl: '/tokens/eth.svg', coingeckoId: 'ethereum',
    minAmount: '0.0001',
  },
  {
    symbol: 'USDC', name: 'USD Coin', decimals: 6,
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', chainId: 42161, isNative: false,
    logoUrl: '/tokens/usdc.svg', coingeckoId: 'usd-coin',
    minAmount: '0.01',
  },
  {
    symbol: 'USDT', name: 'Tether USD', decimals: 6,
    address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', chainId: 42161, isNative: false,
    logoUrl: '/tokens/usdt.svg', coingeckoId: 'tether',
    minAmount: '0.01',
  },
  {
    symbol: 'ARB', name: 'Arbitrum', decimals: 18,
    address: '0x912CE59144191C1204E64559FE8253a0e49E6548', chainId: 42161, isNative: false,
    logoUrl: '/tokens/arb.svg', coingeckoId: 'arbitrum',
    minAmount: '0.1',
  },
]

// ═══════════ HELPER FUNCTIONS ═══════════

/** Get all tokens for a specific chain */
export function getTokensForChain(chainId: number): TokenInfo[] {
  return TOKEN_LIST.filter(t => t.chainId === chainId)
}

/** Get a specific token by symbol and chain */
export function getToken(symbol: string, chainId: number): TokenInfo | undefined {
  return TOKEN_LIST.find(t => t.symbol === symbol && t.chainId === chainId)
}

/** Get native token for a chain */
export function getNativeToken(chainId: number): TokenInfo | undefined {
  return TOKEN_LIST.find(t => t.chainId === chainId && t.isNative)
}

/** Get token by contract address and chain */
export function getTokenByAddress(address: string, chainId: number): TokenInfo | undefined {
  return TOKEN_LIST.find(
    t => t.chainId === chainId && t.address?.toLowerCase() === address.toLowerCase()
  )
}

/** All unique symbols across all chains */
export function getAllSymbols(): string[] {
  return [...new Set(TOKEN_LIST.map(t => t.symbol))]
}

/** All unique coingecko IDs (for batch price fetch) */
export function getAllCoingeckoIds(): string[] {
  return [...new Set(TOKEN_LIST.map(t => t.coingeckoId))]
}
