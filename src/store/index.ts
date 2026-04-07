/**
 * src/store/index.ts — Combined Zustand store
 *
 * Merges all slices into a single store with devtools support.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { createWalletSlice, type WalletSlice } from './slices/wallet';
import { createSwapSlice, type SwapSlice } from './slices/swap';
import { createUISlice, type UISlice } from './slices/ui';

/** Combined app store type */
export type AppStore = WalletSlice & SwapSlice & UISlice;

/**
 * Global app store combining wallet, swap, and UI slices.
 */
export const useAppStore = create<AppStore>()(
  devtools(
    (...args) => ({
      ...createWalletSlice(...args),
      ...createSwapSlice(...args),
      ...createUISlice(...args),
    }),
    { name: 'web3-wallet-connect' },
  ),
);

// Re-export slice types
export type { WalletSlice } from './slices/wallet';
export type { SwapSlice } from './slices/swap';
export type { UISlice, Toast, ModalId, EnhancedToast, ToastAction } from './slices/ui';
