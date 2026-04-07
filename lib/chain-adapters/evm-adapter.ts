/**
 * lib/chain-adapters/evm-adapter.ts — EVM ChainAdapter implementation
 *
 * Wraps existing wagmi/viem logic behind the universal ChainAdapter interface.
 * Does NOT reimplement anything — delegates to existing functions.
 */

import type {
  FeeRouterCapableAdapter,
  UniversalBalance,
  UniversalToken,
  UniversalTxRequest,
} from './types'
import { getChain } from '../../src/config/chains'
import { isFeeRouterAvailable } from '../contractRegistry'

export function createEVMAdapter(chainId: number): FeeRouterCapableAdapter {
  const chain = getChain(chainId)
  if (!chain) throw new Error(`Unsupported EVM chain: ${chainId}`)

  return {
    family: 'evm',
    chainId,
    name: chain.name,

    isValidAddress(address: string): boolean {
      return /^0x[0-9a-fA-F]{40}$/.test(address)
    },

    formatAddress(address: string): string {
      if (!address || address.length < 12) return address
      return `${address.slice(0, 6)}...${address.slice(-4)}`
    },

    async getNativeBalance(_address: string): Promise<UniversalBalance> {
      // TODO: connect to existing viem publicClient.getBalance
      throw new Error('TODO: connect to existing viem balance logic')
    },

    async getTokenBalance(_address: string, _token: UniversalToken): Promise<UniversalBalance> {
      // TODO: connect to existing multicall balance logic
      throw new Error('TODO: connect to existing multicall balance logic')
    },

    async getAllBalances(_address: string): Promise<UniversalBalance[]> {
      // TODO: connect to existing portfolio/balance logic
      throw new Error('TODO: connect to existing portfolio/balance logic')
    },

    getTxExplorerUrl(hash: string): string {
      const explorer = chain.blockExplorers?.[0]?.url ?? 'https://etherscan.io'
      return `${explorer}/tx/${hash}`
    },

    getAddressExplorerUrl(address: string): string {
      const explorer = chain.blockExplorers?.[0]?.url ?? 'https://etherscan.io'
      return `${explorer}/address/${address}`
    },

    async getSwapQuote(_params) {
      // TODO: connect to existing useSwapQuote / Uniswap V3 quoter logic
      throw new Error('TODO: connect to existing Uniswap V3 quote logic')
    },

    async buildSwapTx(_params) {
      // TODO: connect to existing swap router TX builder
      throw new Error('TODO: connect to existing swap TX builder')
    },

    async buildFeeRouterTx(_params) {
      if (!isFeeRouterAvailable(chainId)) {
        throw new Error(`FeeRouter not deployed on chain ${chainId}`)
      }
      // TODO: connect to existing FeeRouter TX builder from TransferForm
      throw new Error('TODO: connect to existing FeeRouter logic')
    },
  }
}
