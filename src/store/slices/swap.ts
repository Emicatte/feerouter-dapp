/**
 * src/store/slices/swap.ts — Zustand slice: swap form state
 *
 * Manages token selection, amounts, slippage, deadline, and
 * transaction status for the swap form.
 */

import type { StateCreator } from 'zustand';
import type { Token } from '../../types/token';
import type { SwapQuote, SlippagePreset } from '../../types/swap';
import type { TxStatus } from '../../types/transaction';
import { DEFAULT_SLIPPAGE, DEFAULT_DEADLINE_MINUTES } from '../../lib/swap/slippage';

/** Swap slice state */
export interface SwapSlice {
  tokenIn: Token | null;
  tokenOut: Token | null;
  amountIn: string;
  amountOut: string;
  slippage: number;
  quote: SwapQuote | null;
  isQuoting: boolean;
  deadline: number;
  txStatus: TxStatus;
  txHash: `0x${string}` | null;
  txError: string | null;
  setTokenIn: (token: Token | null) => void;
  setTokenOut: (token: Token | null) => void;
  setAmountIn: (amount: string) => void;
  setAmountOut: (amount: string) => void;
  setSlippage: (slippage: SlippagePreset | number) => void;
  setQuote: (quote: SwapQuote | null) => void;
  setIsQuoting: (isQuoting: boolean) => void;
  setDeadline: (deadline: number) => void;
  setTxStatus: (status: TxStatus) => void;
  setTxHash: (hash: `0x${string}` | null) => void;
  setTxError: (error: string | null) => void;
  flipTokens: () => void;
  resetSwap: () => void;
}

/** Swap slice creator */
export const createSwapSlice: StateCreator<SwapSlice> = (set) => ({
  tokenIn: null,
  tokenOut: null,
  amountIn: '',
  amountOut: '',
  slippage: DEFAULT_SLIPPAGE,
  quote: null,
  isQuoting: false,
  deadline: DEFAULT_DEADLINE_MINUTES,
  txStatus: 'idle',
  txHash: null,
  txError: null,
  setTokenIn: (token) => set({ tokenIn: token, quote: null }),
  setTokenOut: (token) => set({ tokenOut: token, quote: null }),
  setAmountIn: (amount) => set({ amountIn: amount, quote: null }),
  setAmountOut: (amount) => set({ amountOut: amount }),
  setSlippage: (slippage) => set({ slippage }),
  setQuote: (quote) => set({ quote }),
  setIsQuoting: (isQuoting) => set({ isQuoting }),
  setDeadline: (deadline) => set({ deadline }),
  setTxStatus: (status) => set({ txStatus: status }),
  setTxHash: (hash) => set({ txHash: hash }),
  setTxError: (error) => set({ txError: error }),
  flipTokens: () =>
    set((state) => ({
      tokenIn: state.tokenOut,
      tokenOut: state.tokenIn,
      amountIn: state.amountOut,
      amountOut: state.amountIn,
      quote: null,
    })),
  resetSwap: () =>
    set({
      tokenIn: null,
      tokenOut: null,
      amountIn: '',
      amountOut: '',
      quote: null,
      isQuoting: false,
      txStatus: 'idle',
      txHash: null,
      txError: null,
    }),
});
