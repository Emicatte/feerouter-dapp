/**
 * src/lib/swap/router.ts — Uniswap V3 router integration
 *
 * Builds and encodes swap transaction calldata for SwapRouter.
 * Supports: exactInputSingle (1-hop), exactInput (multi-hop),
 * native ETH value forwarding, WETH wrap/unwrap detection.
 */

import { encodeFunctionData } from 'viem';
import type { SwapParams, SwapQuote } from '../../types/swap';
import type { SupportedChainId } from '../../types/chain';
import { UNISWAP_V3_ROUTER_ABI } from '../../constants/abis/uniswapV3Router';
import { CONTRACT_ADDRESSES, NATIVE_ADDRESS } from '../../constants/addresses';
import { encodeV3Path, swapDeadline, type FeeTier } from '../evm/encoder';
import { calculateMinimumReceived } from './slippage';

/** Encoded swap transaction ready for submission */
export interface EncodedSwap {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
}

/** Result of wrap/unwrap detection */
export interface WrapUnwrapResult {
  isWrap: boolean;
  isUnwrap: boolean;
}

/**
 * Detect if the swap is actually a WETH wrap (ETH → WETH) or unwrap (WETH → ETH).
 * These don't go through the router — they call the WETH contract directly.
 * @param quote - The swap quote to check
 * @param chainId - Target chain
 */
export function detectWrapUnwrap(
  quote: SwapQuote,
  chainId: SupportedChainId,
): WrapUnwrapResult {
  const wethAddr = CONTRACT_ADDRESSES[chainId].weth.toLowerCase();
  const inIsNative =
    quote.inputToken.isNative ||
    quote.inputToken.address.toLowerCase() === NATIVE_ADDRESS.toLowerCase();
  const outIsNative =
    quote.outputToken.isNative ||
    quote.outputToken.address.toLowerCase() === NATIVE_ADDRESS.toLowerCase();
  const inIsWeth = quote.inputToken.address.toLowerCase() === wethAddr;
  const outIsWeth = quote.outputToken.address.toLowerCase() === wethAddr;

  return {
    isWrap: inIsNative && outIsWeth,
    isUnwrap: inIsWeth && outIsNative,
  };
}

/**
 * Build the calldata for a WETH deposit (wrap ETH → WETH).
 * @param amount - Amount of ETH to wrap
 * @param chainId - Target chain
 */
export function buildWrapCalldata(
  amount: bigint,
  chainId: SupportedChainId,
): EncodedSwap {
  const wethAddr = CONTRACT_ADDRESSES[chainId].weth;

  // WETH.deposit() has no arguments — just send ETH as value
  // The function selector for deposit() is 0xd0e30db0
  return {
    to: wethAddr,
    data: '0xd0e30db0',
    value: amount,
  };
}

/**
 * Build the calldata for a WETH withdrawal (unwrap WETH → ETH).
 * @param amount - Amount of WETH to unwrap
 * @param chainId - Target chain
 */
export function buildUnwrapCalldata(
  amount: bigint,
  chainId: SupportedChainId,
): EncodedSwap {
  const wethAddr = CONTRACT_ADDRESSES[chainId].weth;

  // WETH.withdraw(uint256) — selector 0x2e1a7d4d
  const data = encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'withdraw',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'wad', type: 'uint256' }],
        outputs: [],
      },
    ] as const,
    functionName: 'withdraw',
    args: [amount],
  });

  return {
    to: wethAddr,
    data,
    value: 0n,
  };
}

/**
 * Encode a single-hop swap via SwapRouter.exactInputSingle.
 * @internal
 */
function encodeSingleHopSwap(
  quote: SwapQuote,
  recipient: `0x${string}`,
  amountOutMinimum: bigint,
  deadline: bigint,
  chainId: SupportedChainId,
): EncodedSwap {
  const routerAddr = CONTRACT_ADDRESSES[chainId].uniswapV3Router;
  const isNativeIn =
    quote.inputToken.isNative ||
    quote.inputToken.address.toLowerCase() === NATIVE_ADDRESS.toLowerCase();

  const tokenIn = isNativeIn
    ? CONTRACT_ADDRESSES[chainId].weth
    : quote.inputToken.address;
  const tokenOut = quote.outputToken.isNative
    ? CONTRACT_ADDRESSES[chainId].weth
    : quote.outputToken.address;
  const fee = quote.route.pools[0].fee;

  const data = encodeFunctionData({
    abi: UNISWAP_V3_ROUTER_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn,
        tokenOut,
        fee,
        recipient,
        deadline,
        amountIn: quote.inputAmount,
        amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  return {
    to: routerAddr,
    data,
    value: isNativeIn ? quote.inputAmount : 0n,
  };
}

/**
 * Encode a multi-hop swap via SwapRouter.exactInput.
 * @internal
 */
function encodeMultiHopSwap(
  quote: SwapQuote,
  recipient: `0x${string}`,
  amountOutMinimum: bigint,
  deadline: bigint,
  chainId: SupportedChainId,
): EncodedSwap {
  const routerAddr = CONTRACT_ADDRESSES[chainId].uniswapV3Router;
  const isNativeIn =
    quote.inputToken.isNative ||
    quote.inputToken.address.toLowerCase() === NATIVE_ADDRESS.toLowerCase();

  // Build the encoded path: token0 + fee01 + token1 + fee12 + token2
  const pathTokens = quote.route.path.map((t) => {
    if (t.isNative || t.address.toLowerCase() === NATIVE_ADDRESS.toLowerCase()) {
      return CONTRACT_ADDRESSES[chainId].weth;
    }
    return t.address;
  });
  const pathFees = quote.route.pools.map((p) => p.fee as FeeTier);
  const encodedPath = encodeV3Path(pathTokens, pathFees);

  const data = encodeFunctionData({
    abi: UNISWAP_V3_ROUTER_ABI,
    functionName: 'exactInput',
    args: [
      {
        path: encodedPath,
        recipient,
        deadline,
        amountIn: quote.inputAmount,
        amountOutMinimum,
      },
    ],
  });

  return {
    to: routerAddr,
    data,
    value: isNativeIn ? quote.inputAmount : 0n,
  };
}

/**
 * Encode a swap transaction for the Uniswap V3 SwapRouter.
 * Handles:
 * - Single-hop via exactInputSingle
 * - Multi-hop via exactInput with encoded path
 * - Native ETH as msg.value when input is native
 * - WETH wrap/unwrap bypass
 *
 * @param params - Fully resolved swap parameters
 */
export async function encodeSwapTransaction(
  params: SwapParams,
): Promise<EncodedSwap> {
  const { quote, recipient, slippageTolerance, deadline: deadlineMinutes } = params;

  // Infer chainId from the input token
  const chainId = quote.inputToken.chainId as SupportedChainId;

  // Check for wrap/unwrap
  const { isWrap, isUnwrap } = detectWrapUnwrap(quote, chainId);
  if (isWrap) return buildWrapCalldata(quote.inputAmount, chainId);
  if (isUnwrap) return buildUnwrapCalldata(quote.inputAmount, chainId);

  // Calculate minimum output with slippage
  const amountOutMinimum = calculateMinimumReceived(
    quote.outputAmount,
    slippageTolerance,
  );

  const deadline = swapDeadline(deadlineMinutes);

  // Single-hop vs multi-hop
  const isSingleHop = quote.route.path.length === 2;

  if (isSingleHop) {
    return encodeSingleHopSwap(quote, recipient, amountOutMinimum, deadline, chainId);
  }

  return encodeMultiHopSwap(quote, recipient, amountOutMinimum, deadline, chainId);
}

/**
 * Get the router contract address for a chain.
 * @param chainId - Target chain
 */
export function getRouterAddress(chainId: SupportedChainId): `0x${string}` {
  return CONTRACT_ADDRESSES[chainId].uniswapV3Router;
}
