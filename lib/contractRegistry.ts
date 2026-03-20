/**
 * lib/contractRegistry.ts — Multi-Chain Contract Registry
 *
 * Mappa dinamica: chainId → indirizzi contratti + token config
 *
 * Uso:
 *   const reg = getRegistry(chainId)
 *   reg.feeRouter    → indirizzo FeeRouterV4
 *   reg.tokens.USDC  → { address, decimals, logoURI, gasless, poolFee }
 */

export type ChainId = number

// Pool fee tiers Uniswap V3
export const POOL_FEE = {
  LOWEST: 100,   // 0.01% — USDC/EURC
  LOW:    500,   // 0.05% — ETH/USDC
  MEDIUM: 3_000, // 0.30% — ETH/BTC
  HIGH:   10_000,// 1.00%
} as const

export interface TokenConfig {
  address:  `0x${string}`
  decimals: number
  symbol:   string
  name:     string
  logoURI:  string
  gasless:  boolean
  isEurc:   boolean
  isNative: boolean
  // Uniswap V3 pool fee verso WETH (per quote)
  poolFeeToWETH: number
}

export interface NetworkRegistry {
  chainId:     number
  chainName:   string
  isL2:        boolean
  feeRouter:   `0x${string}`
  permit2:     `0x${string}`
  weth:        `0x${string}`
  swapRouter:  `0x${string}`
  rpcUrl:      string
  blockExplorer: string
  tokens:      Record<string, TokenConfig>
  // Gas warning per L1
  gasWarning?: string
}

const PERMIT2       = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as `0x${string}`
const SWAP_ROUTER   = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' as `0x${string}`

// ── Logo CDN ───────────────────────────────────────────────────────────────
const LOGOS = {
  ETH:   'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
  WETH:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
  USDC:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
  USDT:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
  EURC:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c/logo.png',
  cbBTC: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/bitcoin/info/logo.png',
  WBTC:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png',
  DEGEN: 'https://assets.coingecko.com/coins/images/34515/small/android-chrome-512x512.png',
}

// ══════════════════════════════════════════════════════════════════════════
const REGISTRY: { [key: number]: NetworkRegistry } = {

  // ── Base Mainnet ─────────────────────────────────────────────────────
  8453: {
    chainId:      8453,
    chainName:    'Base',
    isL2:         true,
    feeRouter:    (process.env.NEXT_PUBLIC_FEE_ROUTER_V4_BASE
      ?? process.env.NEXT_PUBLIC_FEE_ROUTER_V3_ADDRESS
      ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    permit2:      PERMIT2,
    weth:         '0x4200000000000000000000000000000000000006',
    swapRouter:   SWAP_ROUTER,
    rpcUrl:       'https://mainnet.base.org',
    blockExplorer: 'https://basescan.org',
    tokens: {
      ETH: {
        address:  '0x0000000000000000000000000000000000000000',
        decimals: 18, symbol: 'ETH', name: 'Ethereum',
        logoURI: LOGOS.ETH, gasless: false, isEurc: false, isNative: true,
        poolFeeToWETH: 0,
      },
      USDC: {
        address:  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        decimals: 6, symbol: 'USDC', name: 'USD Coin',
        logoURI: LOGOS.USDC, gasless: true, isEurc: false, isNative: false,
        poolFeeToWETH: POOL_FEE.LOW,
      },
      USDT: {
        address:  '0xfde4C96256153236aF98292015bA958c14714C22',
        decimals: 6, symbol: 'USDT', name: 'Tether USD',
        logoURI: LOGOS.USDT, gasless: true, isEurc: false, isNative: false,
        poolFeeToWETH: POOL_FEE.LOW,
      },
      EURC: {
        address:  '0x60a3E35Cc3064fC371f477011b3E9dd2313ec445',
        decimals: 6, symbol: 'EURC', name: 'Euro Coin',
        logoURI: LOGOS.EURC, gasless: true, isEurc: true, isNative: false,
        poolFeeToWETH: POOL_FEE.LOW,
      },
      cbBTC: {
        address:  '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
        decimals: 8, symbol: 'cbBTC', name: 'Coinbase Wrapped BTC',
        logoURI: LOGOS.cbBTC, gasless: false, isEurc: false, isNative: false,
        poolFeeToWETH: POOL_FEE.MEDIUM,
      },
      DEGEN: {
        address:  '0x4eDBc9320305298056041910220E3663A92540B6',
        decimals: 18, symbol: 'DEGEN', name: 'Degen',
        logoURI: LOGOS.DEGEN, gasless: false, isEurc: false, isNative: false,
        poolFeeToWETH: POOL_FEE.MEDIUM,
      },
    },
  },

  // ── Ethereum Mainnet ──────────────────────────────────────────────────
  1: {
    chainId:      1,
    chainName:    'Ethereum',
    isL2:         false,
    feeRouter:    (process.env.NEXT_PUBLIC_FEE_ROUTER_V4_ETH
      ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    permit2:      PERMIT2,
    weth:         '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    swapRouter:   SWAP_ROUTER,
    rpcUrl:       'https://eth-mainnet.g.alchemy.com/v2/demo',
    blockExplorer: 'https://etherscan.io',
    gasWarning:   'Gas su Ethereum L1 è più costoso. Considera di usare Base per transazioni minori.',
    tokens: {
      ETH: {
        address:  '0x0000000000000000000000000000000000000000',
        decimals: 18, symbol: 'ETH', name: 'Ethereum',
        logoURI: LOGOS.ETH, gasless: false, isEurc: false, isNative: true,
        poolFeeToWETH: 0,
      },
      USDC: {
        address:  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        decimals: 6, symbol: 'USDC', name: 'USD Coin',
        logoURI: LOGOS.USDC, gasless: false, isEurc: false, isNative: false,
        poolFeeToWETH: POOL_FEE.LOW,
      },
      USDT: {
        address:  '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        decimals: 6, symbol: 'USDT', name: 'Tether USD',
        logoURI: LOGOS.USDT, gasless: false, isEurc: false, isNative: false,
        poolFeeToWETH: POOL_FEE.LOW,
      },
      EURC: {
        address:  '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c',
        decimals: 6, symbol: 'EURC', name: 'Euro Coin',
        logoURI: LOGOS.EURC, gasless: false, isEurc: true, isNative: false,
        poolFeeToWETH: POOL_FEE.LOW,
      },
      WBTC: {
        address:  '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        decimals: 8, symbol: 'WBTC', name: 'Wrapped Bitcoin',
        logoURI: LOGOS.WBTC, gasless: false, isEurc: false, isNative: false,
        poolFeeToWETH: POOL_FEE.MEDIUM,
      },
    },
  },

  // ── Base Sepolia (testnet) ────────────────────────────────────────────
  84532: {
    chainId:      84532,
    chainName:    'Base Sepolia',
    isL2:         true,
    feeRouter:    (process.env.NEXT_PUBLIC_FEE_ROUTER_V3_ADDRESS
      ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    permit2:      PERMIT2,
    weth:         '0x4200000000000000000000000000000000000006',
    swapRouter:   SWAP_ROUTER,
    rpcUrl:       'https://sepolia.base.org',
    blockExplorer: 'https://sepolia.basescan.org',
    tokens: {
      ETH: {
        address:  '0x0000000000000000000000000000000000000000',
        decimals: 18, symbol: 'ETH', name: 'Ethereum (Testnet)',
        logoURI: LOGOS.ETH, gasless: false, isEurc: false, isNative: true,
        poolFeeToWETH: 0,
      },
      USDC: {
        address:  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        decimals: 6, symbol: 'USDC', name: 'USD Coin (Testnet)',
        logoURI: LOGOS.USDC, gasless: true, isEurc: false, isNative: false,
        poolFeeToWETH: POOL_FEE.LOW,
      },
    },
  },
}

// ── API pubblica ───────────────────────────────────────────────────────────

export function getRegistry(chainId: number): NetworkRegistry | null {
  return REGISTRY[chainId] ?? null
}

export function getToken(chainId: number, symbol: string): TokenConfig | null {
  return REGISTRY[chainId]?.tokens[symbol] ?? null
}

export function getSupportedChains(): number[] {
  return Object.keys(REGISTRY).map(Number)
}

export function isChainSupported(chainId: number): boolean {
  return chainId in REGISTRY
}

// Ritorna il chainId corretto per un dato token symbol
export function findChainForToken(symbol: string): number[] {
  return Object.entries(REGISTRY)
    .filter(([, reg]) => symbol in reg.tokens)
    .map(([id]) => Number(id))
}

// EUR exchange rates mock (produzione: Chainlink)
export const EUR_RATES: { [symbol: string]: number } = {
  ETH:   2200,
  USDC:  0.92,
  USDT:  0.92,
  EURC:  1.0,
  cbBTC: 88000,
  WBTC:  88000,
  DEGEN: 0.003,
}