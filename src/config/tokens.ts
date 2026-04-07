/**
 * src/config/tokens.ts — Token list per chain (including WBTC)
 *
 * Default token lists for each supported chain.
 * Aligned with the existing app/tokens/tokenRegistry.ts.
 */

import type { Token } from '../types/token';
import type { SupportedChainId } from '../types/chain';

/** All default tokens, indexed by chain */
export const DEFAULT_TOKENS: Record<SupportedChainId, Token[]> = {
  // ═══════════ Ethereum Mainnet ═══════════
  1: [
    {
      symbol: 'ETH', name: 'Ether', decimals: 18,
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      chainId: 1, isNative: true,
      logoURI: '/tokens/eth.svg',
    },
    {
      symbol: 'WETH', name: 'Wrapped Ether', decimals: 18,
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      chainId: 1, isWrapped: true, wrappedAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      logoURI: '/tokens/weth.svg',
    },
    {
      symbol: 'USDC', name: 'USD Coin', decimals: 6,
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      chainId: 1, tags: ['stablecoin'],
      logoURI: '/tokens/usdc.svg',
    },
    {
      symbol: 'USDT', name: 'Tether USD', decimals: 6,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      chainId: 1, tags: ['stablecoin'],
      logoURI: '/tokens/usdt.svg',
    },
    {
      symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18,
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      chainId: 1, tags: ['stablecoin'],
      logoURI: '/tokens/dai.svg',
    },
    {
      symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8,
      address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      chainId: 1, tags: ['wrapped', 'btc'],
      logoURI: '/tokens/btc.svg',
    },
  ],

  // ═══════════ Base Mainnet ═══════════
  8453: [
    {
      symbol: 'ETH', name: 'Ether', decimals: 18,
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      chainId: 8453, isNative: true,
      logoURI: '/tokens/eth.svg',
    },
    {
      symbol: 'USDC', name: 'USD Coin', decimals: 6,
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      chainId: 8453, tags: ['stablecoin'],
      logoURI: '/tokens/usdc.svg',
    },
    {
      symbol: 'USDT', name: 'Tether USD', decimals: 6,
      address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
      chainId: 8453, tags: ['stablecoin'],
      logoURI: '/tokens/usdt.svg',
    },
    {
      symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18,
      address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
      chainId: 8453, tags: ['stablecoin'],
      logoURI: '/tokens/dai.svg',
    },
    {
      symbol: 'WETH', name: 'Wrapped Ether', decimals: 18,
      address: '0x4200000000000000000000000000000000000006',
      chainId: 8453, isWrapped: true,
      logoURI: '/tokens/weth.svg',
    },
    {
      symbol: 'cbBTC', name: 'Coinbase BTC', decimals: 8,
      address: '0xcbB7C0000AB88B473b1f5aFd9ef808440eed33Bf',
      chainId: 8453, tags: ['wrapped', 'btc'],
      logoURI: '/tokens/btc.svg',
    },
  ],

  // ═══════════ Arbitrum One ═══════════
  42161: [
    {
      symbol: 'ETH', name: 'Ether', decimals: 18,
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      chainId: 42161, isNative: true,
      logoURI: '/tokens/eth.svg',
    },
    {
      symbol: 'WETH', name: 'Wrapped Ether', decimals: 18,
      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      chainId: 42161, isWrapped: true, wrappedAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      logoURI: '/tokens/weth.svg',
    },
    {
      symbol: 'USDC', name: 'USD Coin', decimals: 6,
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      chainId: 42161, tags: ['stablecoin'],
      logoURI: '/tokens/usdc.svg',
    },
    {
      symbol: 'USDT', name: 'Tether USD', decimals: 6,
      address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      chainId: 42161, tags: ['stablecoin'],
      logoURI: '/tokens/usdt.svg',
    },
    {
      symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18,
      address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
      chainId: 42161, tags: ['stablecoin'],
      logoURI: '/tokens/dai.svg',
    },
    {
      symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8,
      address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
      chainId: 42161, tags: ['wrapped', 'btc'],
      logoURI: '/tokens/btc.svg',
    },
    {
      symbol: 'ARB', name: 'Arbitrum', decimals: 18,
      address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
      chainId: 42161,
      logoURI: '/tokens/arb.svg',
    },
  ],

  // ═══════════ Optimism ═══════════
  10: [
    {
      symbol: 'ETH', name: 'Ether', decimals: 18,
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      chainId: 10, isNative: true,
      logoURI: '/tokens/eth.svg',
    },
    {
      symbol: 'WETH', name: 'Wrapped Ether', decimals: 18,
      address: '0x4200000000000000000000000000000000000006',
      chainId: 10, isWrapped: true, wrappedAddress: '0x4200000000000000000000000000000000000006',
      logoURI: '/tokens/weth.svg',
    },
    {
      symbol: 'USDC', name: 'USD Coin', decimals: 6,
      address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      chainId: 10, tags: ['stablecoin'],
      logoURI: '/tokens/usdc.svg',
    },
    {
      symbol: 'USDT', name: 'Tether USD', decimals: 6,
      address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
      chainId: 10, tags: ['stablecoin'],
      logoURI: '/tokens/usdt.svg',
    },
    {
      symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18,
      address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
      chainId: 10, tags: ['stablecoin'],
      logoURI: '/tokens/dai.svg',
    },
    {
      symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8,
      address: '0x68f180fcCe6836688e9084f035309E29Bf0A2095',
      chainId: 10, tags: ['wrapped', 'btc'],
      logoURI: '/tokens/btc.svg',
    },
    {
      symbol: 'OP', name: 'Optimism', decimals: 18,
      address: '0x4200000000000000000000000000000000000042',
      chainId: 10,
      logoURI: '/tokens/op.svg',
    },
  ],

  // ═══════════ BNB Chain ═══════════
  56: [
    {
      symbol: 'BNB', name: 'BNB', decimals: 18,
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      chainId: 56, isNative: true,
      logoURI: '/tokens/bnb.svg',
    },
    {
      symbol: 'WBNB', name: 'Wrapped BNB', decimals: 18,
      address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      chainId: 56, isWrapped: true, wrappedAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      logoURI: '/tokens/bnb.svg',
    },
    {
      symbol: 'USDC', name: 'USD Coin', decimals: 18,
      address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      chainId: 56, tags: ['stablecoin'],
      logoURI: '/tokens/usdc.svg',
    },
    {
      symbol: 'USDT', name: 'Tether USD', decimals: 18,
      address: '0x55d398326f99059fF775485246999027B3197955',
      chainId: 56, tags: ['stablecoin'],
      logoURI: '/tokens/usdt.svg',
    },
    {
      symbol: 'BTCB', name: 'Bitcoin BEP2', decimals: 18,
      address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
      chainId: 56, tags: ['wrapped', 'btc'],
      logoURI: '/tokens/btc.svg',
    },
  ],

  // ═══════════ Polygon ═══════════
  137: [
    {
      symbol: 'POL', name: 'POL', decimals: 18,
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      chainId: 137, isNative: true,
      logoURI: '/tokens/matic.svg',
    },
    {
      symbol: 'WMATIC', name: 'Wrapped MATIC', decimals: 18,
      address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      chainId: 137, isWrapped: true, wrappedAddress: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      logoURI: '/tokens/matic.svg',
    },
    {
      symbol: 'USDC', name: 'USD Coin', decimals: 6,
      address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      chainId: 137, tags: ['stablecoin'],
      logoURI: '/tokens/usdc.svg',
    },
    {
      symbol: 'USDT', name: 'Tether USD', decimals: 6,
      address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      chainId: 137, tags: ['stablecoin'],
      logoURI: '/tokens/usdt.svg',
    },
    {
      symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18,
      address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
      chainId: 137, tags: ['stablecoin'],
      logoURI: '/tokens/dai.svg',
    },
    {
      symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8,
      address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
      chainId: 137, tags: ['wrapped', 'btc'],
      logoURI: '/tokens/btc.svg',
    },
  ],

  // ═══════════ ZKsync Era ═══════════
  324: [
    {
      symbol: 'ETH', name: 'Ether', decimals: 18,
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      chainId: 324, isNative: true,
      logoURI: '/tokens/eth.svg',
    },
    {
      symbol: 'WETH', name: 'Wrapped Ether', decimals: 18,
      address: '0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91',
      chainId: 324, isWrapped: true, wrappedAddress: '0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91',
      logoURI: '/tokens/weth.svg',
    },
    {
      symbol: 'USDC', name: 'USD Coin', decimals: 6,
      address: '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4',
      chainId: 324, tags: ['stablecoin'],
      logoURI: '/tokens/usdc.svg',
    },
    {
      symbol: 'USDT', name: 'Tether USD', decimals: 6,
      address: '0x493257fD37EDB34451f62EDf8D2a0C418852bA4C',
      chainId: 324, tags: ['stablecoin'],
      logoURI: '/tokens/usdt.svg',
    },
  ],

  // ═══════════ Celo ═══════════
  42220: [
    {
      symbol: 'CELO', name: 'Celo', decimals: 18,
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      chainId: 42220, isNative: true,
      logoURI: '/tokens/celo.svg',
    },
    {
      symbol: 'USDC', name: 'USD Coin', decimals: 6,
      address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
      chainId: 42220, tags: ['stablecoin'],
      logoURI: '/tokens/usdc.svg',
    },
  ],

  // ═══════════ Avalanche ═══════════
  43114: [
    {
      symbol: 'AVAX', name: 'Avalanche', decimals: 18,
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      chainId: 43114, isNative: true,
      logoURI: '/tokens/avax.svg',
    },
    {
      symbol: 'WAVAX', name: 'Wrapped AVAX', decimals: 18,
      address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
      chainId: 43114, isWrapped: true, wrappedAddress: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
      logoURI: '/tokens/avax.svg',
    },
    {
      symbol: 'USDC', name: 'USD Coin', decimals: 6,
      address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
      chainId: 43114, tags: ['stablecoin'],
      logoURI: '/tokens/usdc.svg',
    },
    {
      symbol: 'USDT', name: 'Tether USD', decimals: 6,
      address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
      chainId: 43114, tags: ['stablecoin'],
      logoURI: '/tokens/usdt.svg',
    },
    {
      symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8,
      address: '0x50b7545627a5162F82A992c33b87aDc75187B218',
      chainId: 43114, tags: ['wrapped', 'btc'],
      logoURI: '/tokens/btc.svg',
    },
  ],

  // ═══════════ Blast ═══════════
  81457: [
    {
      symbol: 'ETH', name: 'Ether', decimals: 18,
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      chainId: 81457, isNative: true,
      logoURI: '/tokens/eth.svg',
    },
    {
      symbol: 'WETH', name: 'Wrapped Ether', decimals: 18,
      address: '0x4300000000000000000000000000000000000004',
      chainId: 81457, isWrapped: true, wrappedAddress: '0x4300000000000000000000000000000000000004',
      logoURI: '/tokens/weth.svg',
    },
    {
      symbol: 'USDB', name: 'USDB', decimals: 18,
      address: '0x4300000000000000000000000000000000000003',
      chainId: 81457, tags: ['stablecoin'],
      logoURI: '/tokens/usdb.svg',
    },
  ],

  // ═══════════ Base Sepolia ═══════════
  84532: [
    {
      symbol: 'ETH', name: 'Ether (Sepolia)', decimals: 18,
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      chainId: 84532, isNative: true,
      logoURI: '/tokens/eth.svg',
    },
    {
      symbol: 'USDC', name: 'USDC (Sepolia)', decimals: 6,
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      chainId: 84532, tags: ['stablecoin'],
      logoURI: '/tokens/usdc.svg',
    },
  ],
};

/**
 * Get default tokens for a specific chain.
 */
export function getDefaultTokens(chainId: number): Token[] {
  return DEFAULT_TOKENS[chainId as SupportedChainId] ?? [];
}

/**
 * Find a token by address on a given chain.
 */
export function findToken(address: `0x${string}`, chainId: number): Token | undefined {
  const tokens = getDefaultTokens(chainId);
  return tokens.find(t => t.address.toLowerCase() === address.toLowerCase());
}

/**
 * Get all WBTC/BTC-related tokens across all chains.
 */
export function getWbtcTokens(): Token[] {
  return Object.values(DEFAULT_TOKENS)
    .flat()
    .filter(t => t.tags?.includes('btc'));
}
