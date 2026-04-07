/**
 * src/hooks/usePriceOracle.ts — Price oracle hook
 *
 * Provides real-time token prices with automatic refresh,
 * batch price fetching, chain-specific pricing, and
 * tab-visibility-aware polling.
 */

'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  fetchPrices,
  getBatchPrices,
  getCoingeckoId,
  type PriceMap,
  type PriceResult,
} from '../lib/price/oracle';
import {
  cachePrices,
  getCachedPrice,
  loadPersistedPrices,
  persistTopPrices,
} from '../lib/price/cache';
import type { Token } from '../types/token';
import type { SupportedChainId } from '../types/chain';

/** Refresh interval in milliseconds (30 seconds) */
const REFRESH_INTERVAL = 30_000;

/** Return type of the price oracle hook */
export interface UsePriceOracleReturn {
  prices: PriceMap;
  isLoading: boolean;
  getPrice: (coingeckoId: string) => { usd: number; eur: number } | null;
  refetch: () => Promise<void>;
}

/**
 * Hook for real-time token prices with auto-refresh.
 * @param coingeckoIds - Array of CoinGecko token IDs to track
 */
export function usePriceOracle(coingeckoIds: string[]): UsePriceOracleReturn {
  const [prices, setPrices] = useState<PriceMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refetch = useCallback(async () => {
    if (coingeckoIds.length === 0) return;
    try {
      const data = await fetchPrices(coingeckoIds);
      cachePrices(data);
      setPrices(data);
    } catch {
      // Keep stale prices on error
    } finally {
      setIsLoading(false);
    }
  }, [coingeckoIds]);

  useEffect(() => {
    refetch();
    intervalRef.current = setInterval(refetch, REFRESH_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refetch]);

  const getPrice = useCallback((id: string) => {
    const cached = getCachedPrice(id);
    if (cached) return { usd: cached.usd, eur: cached.eur };
    const live = prices[id];
    if (live) return { usd: live.usd, eur: live.eur };
    return null;
  }, [prices]);

  return { prices, isLoading, getPrice, refetch };
}

// ────────────────────────────────────────────────────────────────
// Enhanced portfolio price hook (PROMPT 6)
// ────────────────────────────────────────────────────────────────

/** Return type of the portfolio prices hook */
export interface UsePortfolioPricesReturn {
  /** Map of lowercase token address → price result */
  priceMap: Map<string, PriceResult>;
  /** Simple lookup: USD price by token address */
  getTokenPrice: (address: `0x${string}`) => number;
  /** Get BTC ratio for WBTC-like tokens */
  getBtcRatio: (address: `0x${string}`) => number | undefined;
  /** Whether initial fetch is in progress */
  isLoading: boolean;
  /** Trigger a manual refresh */
  refetch: () => Promise<void>;
  /** Last successful fetch timestamp */
  lastUpdated: number | null;
}

/**
 * Hook for portfolio token prices with chain-specific batch fetching.
 *
 * Features:
 * - Batch CoinGecko fetch (single API call for all tokens)
 * - Tab-visibility-aware polling (pauses in background)
 * - localStorage cold-start from persisted cache
 * - Chain-specific pricing
 *
 * @param tokens - Array of tokens to price
 * @param chainId - Current chain ID
 */
export function usePortfolioPrices(
  tokens: Token[],
  chainId: SupportedChainId,
): UsePortfolioPricesReturn {
  const [priceMap, setPriceMap] = useState<Map<string, PriceResult>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isVisibleRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  // Load persisted prices on mount
  useEffect(() => {
    loadPersistedPrices();
  }, []);

  // Track tab visibility
  useEffect(() => {
    function handleVisibility() {
      isVisibleRef.current = !document.hidden;
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Stable token list key to avoid unnecessary refetches
  const tokenKey = useMemo(
    () => tokens.map((t) => `${t.chainId}:${t.address}`).sort().join(','),
    [tokens],
  );

  const fetchBatch = useCallback(async () => {
    if (tokens.length === 0) {
      setIsLoading(false);
      return;
    }

    // Abort previous fetch if still running
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const batchTokens = tokens.map((t) => ({
        address: t.address,
        symbol: t.symbol,
        decimals: t.decimals,
      }));

      const results = await getBatchPrices(batchTokens, chainId);
      setPriceMap(results);
      setLastUpdated(Date.now());
      persistTopPrices();
    } catch (err) {
      // Keep stale prices on error
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.warn('[usePortfolioPrices] Fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenKey, chainId]);

  // Initial fetch + polling
  useEffect(() => {
    fetchBatch();

    intervalRef.current = setInterval(() => {
      if (isVisibleRef.current) {
        fetchBatch();
      }
    }, REFRESH_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      abortRef.current?.abort();
    };
  }, [fetchBatch]);

  // Lookups
  const getTokenPrice = useCallback(
    (address: `0x${string}`) => {
      return priceMap.get(address.toLowerCase())?.usd ?? 0;
    },
    [priceMap],
  );

  const getBtcRatio = useCallback(
    (address: `0x${string}`) => {
      return priceMap.get(address.toLowerCase())?.btcRatio;
    },
    [priceMap],
  );

  return {
    priceMap,
    getTokenPrice,
    getBtcRatio,
    isLoading,
    refetch: fetchBatch,
    lastUpdated,
  };
}
