/**
 * src/hooks/useChainSwitch.ts — Chain switching hook
 *
 * Provides chain switching with auto addChain, error handling,
 * loading state, event callbacks, and query invalidation on switch.
 */

'use client';

import { useCallback, useRef, useState } from 'react';
import { useChainId, useSwitchChain } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import type { SupportedChainId } from '../types/chain';
import { isSupportedChain } from '../config/chains';

/** Callbacks for chain switch events */
export interface ChainSwitchCallbacks {
  /** Fires after a successful chain switch */
  onChainSwitched?: (newChainId: number) => void;
  /** Fires when the user rejects the switch */
  onSwitchRejected?: () => void;
  /** Fires on any switch error */
  onSwitchError?: (error: Error) => void;
}

/** Return type of the chain switch hook */
export interface UseChainSwitchReturn {
  /** Currently active chain ID */
  currentChainId: number;
  /** Whether the current chain is in our supported list */
  isSupported: boolean;
  /** Request a chain switch (auto-adds chain if missing from wallet) */
  switchChain: (chainId: number) => Promise<void>;
  /** Whether a switch is in progress */
  isSwitching: boolean;
  /** Human-readable error message, if any */
  error: string | null;
  /** Clear the current error */
  clearError: () => void;
}

/**
 * Hook for switching between supported EVM chains.
 *
 * - If the chain isn't configured in the wallet, wagmi automatically
 *   prompts the user to add it (`wallet_addEthereumChain`).
 * - On successful switch, invalidates balance/contract queries so
 *   data refreshes for the new chain.
 * - Provides specific error messages for user rejection vs other failures.
 *
 * @param callbacks - Optional event callbacks
 */
export function useChainSwitch(
  callbacks?: ChainSwitchCallbacks,
): UseChainSwitchReturn {
  const currentChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();

  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const isSupported = isSupportedChain(currentChainId);

  const clearError = useCallback(() => setError(null), []);

  const switchChain = useCallback(
    async (chainId: number) => {
      if (!isSupportedChain(chainId)) {
        setError(`Chain ${chainId} is not supported`);
        return;
      }

      if (chainId === currentChainId) return;

      setIsSwitching(true);
      setError(null);

      try {
        // wagmi's switchChainAsync handles wallet_addEthereumChain internally
        await switchChainAsync({ chainId: chainId as SupportedChainId });

        // Invalidate chain-dependent queries so balances refresh
        await queryClient.invalidateQueries({ queryKey: ['balance'] });
        await queryClient.invalidateQueries({ queryKey: ['readContract'] });
        await queryClient.invalidateQueries({ queryKey: ['readContracts'] });

        callbacksRef.current?.onChainSwitched?.(chainId);
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error('Failed to switch chain');

        if (
          error.message.includes('User rejected') ||
          error.message.includes('user rejected')
        ) {
          setError('Chain switch was rejected');
          callbacksRef.current?.onSwitchRejected?.();
        } else if (error.message.includes('Unrecognized chain')) {
          setError(`Chain ${chainId} is not supported by your wallet`);
          callbacksRef.current?.onSwitchError?.(error);
        } else {
          setError(error.message);
          callbacksRef.current?.onSwitchError?.(error);
        }
      } finally {
        setIsSwitching(false);
      }
    },
    [switchChainAsync, currentChainId, queryClient],
  );

  return {
    currentChainId,
    isSupported,
    switchChain,
    isSwitching,
    error,
    clearError,
  };
}
