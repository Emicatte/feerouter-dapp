/**
 * src/hooks/useTokenBalances.ts — Multi-token balance hook
 *
 * Fetches balances for all tokens on the current chain using multicall.
 * Features: 30s auto-refresh, pause on tab hidden, USD value sorting,
 * chain-switch invalidation, and zero-balance filtering.
 */

'use client';

import { useMemo, useEffect, useRef, useCallback } from 'react';
import { useAccount, useBalance, useReadContracts, useChainId } from 'wagmi';
import { erc20Abi, formatUnits } from 'viem';
import { useQueryClient } from '@tanstack/react-query';
import type { Token, TokenBalance } from '../types/token';
import { getDefaultTokens } from '../config/tokens';

/** Polling interval: 30 seconds */
const POLL_INTERVAL = 30_000;

/** Return type of the token balances hook */
export interface UseTokenBalancesReturn {
  /** All token balances (sorted by USD value desc, then by balance desc) */
  balances: TokenBalance[];
  /** Whether any balance query is loading */
  isLoading: boolean;
  /** Total portfolio USD value (null if prices unavailable) */
  totalUsdValue: number | null;
  /** Manually trigger a refetch */
  refetch: () => void;
}

/**
 * Fetch balances for all default tokens on a given chain.
 * Uses wagmi's multicall under the hood for ERC-20 tokens.
 *
 * Features:
 * - Auto-refresh every 30 seconds when tab is active
 * - Pauses polling when tab is in background (document.hidden)
 * - Invalidates on chain switch
 * - Sorts by USD value (descending), falls back to raw balance
 * - Includes zero-balance tokens from default list
 *
 * @param chainId - Target chain ID
 * @param usdPrices - Optional map of token symbol -> USD price for sorting
 */
export function useTokenBalances(
  chainId: number,
  usdPrices?: Record<string, number>,
): UseTokenBalancesReturn {
  const { address } = useAccount();
  const activeChainId = useChainId();
  const queryClient = useQueryClient();

  const tokens = useMemo(() => getDefaultTokens(chainId), [chainId]);
  const nativeToken = useMemo(() => tokens.find((t) => t.isNative), [tokens]);
  const erc20Tokens = useMemo(() => tokens.filter((t) => !t.isNative), [tokens]);

  // Track tab visibility for polling control
  const isVisibleRef = useRef(true);

  useEffect(() => {
    function handleVisibility() {
      isVisibleRef.current = !document.hidden;
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Native balance via wagmi
  const {
    data: nativeData,
    isLoading: nativeLoading,
    refetch: refetchNative,
  } = useBalance({
    address,
    chainId,
    query: { enabled: !!address },
  });

  // ERC-20 balances via wagmi multicall
  const {
    data: erc20Data,
    isLoading: erc20Loading,
    refetch: refetchErc20,
  } = useReadContracts({
    contracts: erc20Tokens.map((t) => ({
      address: t.address,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: address ? [address] : undefined,
      chainId,
    })),
    query: { enabled: !!address && erc20Tokens.length > 0 },
  });

  // Auto-refresh polling (pauses when tab is hidden)
  useEffect(() => {
    if (!address) return;

    const interval = setInterval(() => {
      if (isVisibleRef.current) {
        refetchNative();
        refetchErc20();
      }
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [address, refetchNative, refetchErc20]);

  // Invalidate on chain switch
  const prevChainRef = useRef(activeChainId);
  useEffect(() => {
    if (prevChainRef.current !== activeChainId) {
      prevChainRef.current = activeChainId;
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['readContracts'] });
    }
  }, [activeChainId, queryClient]);

  // Combined refetch
  const refetch = useCallback(() => {
    refetchNative();
    refetchErc20();
  }, [refetchNative, refetchErc20]);

  // Build TokenBalance array with USD values and sorting
  const balances: TokenBalance[] = useMemo(() => {
    const result: TokenBalance[] = [];

    if (nativeToken) {
      const bal = nativeData?.value ?? 0n;
      const usd = computeUsdValue(nativeToken, bal, usdPrices);
      result.push({
        ...nativeToken,
        balance: bal,
        formattedBalance: formatUnits(bal, nativeToken.decimals),
        usdValue: usd,
      });
    }

    erc20Tokens.forEach((token, i) => {
      const raw = erc20Data?.[i];
      const bal = raw?.status === 'success' ? (raw.result as bigint) : 0n;
      const usd = computeUsdValue(token, bal, usdPrices);
      result.push({
        ...token,
        balance: bal,
        formattedBalance: formatUnits(bal, token.decimals),
        usdValue: usd,
      });
    });

    // Sort: USD value desc (non-null first), then raw balance desc
    result.sort((a, b) => {
      if (a.usdValue !== null && b.usdValue !== null) {
        return b.usdValue - a.usdValue;
      }
      if (a.usdValue !== null) return -1;
      if (b.usdValue !== null) return 1;
      if (a.balance > b.balance) return -1;
      if (a.balance < b.balance) return 1;
      return 0;
    });

    return result;
  }, [nativeToken, nativeData, erc20Tokens, erc20Data, usdPrices]);

  // Total USD value
  const totalUsdValue = useMemo(() => {
    const withUsd = balances.filter((b) => b.usdValue !== null);
    if (withUsd.length === 0) return null;
    return withUsd.reduce((sum, b) => sum + (b.usdValue ?? 0), 0);
  }, [balances]);

  const isLoading = nativeLoading || erc20Loading;

  return { balances, isLoading, totalUsdValue, refetch };
}

/**
 * Compute USD value for a token balance.
 * Uses the token's actual decimals (critical for WBTC's 8 decimals).
 * @internal
 */
function computeUsdValue(
  token: Token,
  balance: bigint,
  usdPrices?: Record<string, number>,
): number | null {
  if (!usdPrices) return null;
  const price = usdPrices[token.symbol.toUpperCase()];
  if (price === undefined) return null;
  const formatted = Number(formatUnits(balance, token.decimals));
  return formatted * price;
}
