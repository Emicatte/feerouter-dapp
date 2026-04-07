/**
 * src/config/contracts.ts — Contract address helpers
 *
 * Typed accessors for protocol contract addresses per chain.
 * Provides both individual helpers and a generic getContractAddress()
 * with full type safety and runtime validation.
 */

import type { SupportedChainId } from '../types/chain';
import { CONTRACT_ADDRESSES } from '../constants/addresses';
import { isSupportedChain } from './chains';

/** Known contract names for type-safe lookup */
export type ContractName =
  | 'uniswapV3Router'
  | 'uniswapV3Quoter'
  | 'uniswapV3Factory'
  | 'multicall3'
  | 'weth'
  | 'wbtc';

/**
 * Get a contract address by chain ID and contract name.
 * @param chainId - The chain to look up
 * @param contractName - The contract identifier
 * @returns The contract address
 * @throws If the chain is not supported or the contract is not deployed on that chain.
 */
export function getContractAddress(
  chainId: number,
  contractName: ContractName,
): `0x${string}` {
  if (!isSupportedChain(chainId)) {
    throw new Error(`Chain ${chainId} is not supported`);
  }
  const addresses = CONTRACT_ADDRESSES[chainId];
  const addr = addresses[contractName];
  if (!addr) {
    throw new Error(
      `Contract "${contractName}" is not deployed on chain ${chainId}`,
    );
  }
  return addr;
}

/**
 * Get the Uniswap V3 Router address for a chain.
 */
export function getRouterAddress(chainId: SupportedChainId): `0x${string}` {
  return CONTRACT_ADDRESSES[chainId].uniswapV3Router;
}

/**
 * Get the Uniswap V3 Quoter address for a chain.
 */
export function getQuoterAddress(chainId: SupportedChainId): `0x${string}` {
  return CONTRACT_ADDRESSES[chainId].uniswapV3Quoter;
}

/**
 * Get the Uniswap V3 Factory address for a chain.
 */
export function getFactoryAddress(chainId: SupportedChainId): `0x${string}` {
  return CONTRACT_ADDRESSES[chainId].uniswapV3Factory;
}

/**
 * Get the Multicall3 address for a chain.
 */
export function getMulticall3Address(chainId: SupportedChainId): `0x${string}` {
  return CONTRACT_ADDRESSES[chainId].multicall3;
}

/**
 * Get the WETH (or wrapped native) address for a chain.
 */
export function getWethAddress(chainId: SupportedChainId): `0x${string}` {
  return CONTRACT_ADDRESSES[chainId].weth;
}

/**
 * Get the WBTC address for a chain (null if not available).
 */
export function getWbtcAddress(chainId: SupportedChainId): `0x${string}` | null {
  return CONTRACT_ADDRESSES[chainId].wbtc;
}
