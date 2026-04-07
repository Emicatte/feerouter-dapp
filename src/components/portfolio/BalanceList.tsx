/**
 * src/components/portfolio/BalanceList.tsx — Token balance list
 *
 * Renders a list of token balances sorted by USD value.
 * Features: search bar, zero-balance toggle, virtualized rendering
 * for large token lists (>50), skeleton loader, pull-to-refresh hint.
 */

'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import type { TokenBalance } from '../../types/token';
import { TokenRow, type TokenRowProps } from './TokenRow';

/** Threshold for switching to virtualized rendering */
const VIRTUALIZATION_THRESHOLD = 50;

/** Height of each token row in pixels (for virtualization) */
const ROW_HEIGHT = 68;

/** Number of extra rows to render above/below viewport */
const OVERSCAN_COUNT = 5;

/** BalanceList props */
export interface BalanceListProps {
  balances: TokenBalance[];
  isLoading: boolean;
  /** Optional 24h price changes keyed by lowercase address */
  priceChanges?: Map<string, number>;
  /** Optional BTC ratios keyed by lowercase address */
  btcRatios?: Map<string, number>;
  /** Callback when a token row is clicked */
  onSelectToken?: (token: TokenBalance) => void;
  /** Callback for pull-to-refresh / manual refresh */
  onRefresh?: () => void;
  className?: string;
}

/**
 * List of token balances with search, zero-balance filter,
 * and virtualized rendering for large lists.
 */
export function BalanceList({
  balances,
  isLoading,
  priceChanges,
  btcRatios,
  onSelectToken,
  onRefresh,
  className,
}: BalanceListProps) {
  const [search, setSearch] = useState('');
  const [showZeroBalances, setShowZeroBalances] = useState(false);

  // Filtered and sorted balances
  const filteredBalances = useMemo(() => {
    let result = balances;

    // Filter zero balances
    if (!showZeroBalances) {
      result = result.filter((b) => b.balance > 0n);
    }

    // Search filter
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (b) =>
          b.symbol.toLowerCase().includes(q) ||
          b.name.toLowerCase().includes(q) ||
          b.address.toLowerCase().includes(q),
      );
    }

    // Sort by USD value desc (already sorted from useTokenBalances, but re-sort after filtering)
    return [...result].sort((a, b) => {
      if (a.usdValue !== null && b.usdValue !== null) return b.usdValue - a.usdValue;
      if (a.usdValue !== null) return -1;
      if (b.usdValue !== null) return 1;
      if (a.balance > b.balance) return -1;
      if (a.balance < b.balance) return 1;
      return 0;
    });
  }, [balances, search, showZeroBalances]);

  const zeroCount = useMemo(
    () => balances.filter((b) => b.balance === 0n).length,
    [balances],
  );

  const useVirtualization = filteredBalances.length > VIRTUALIZATION_THRESHOLD;

  // Skeleton loader
  if (isLoading) {
    return (
      <div className={`balance-list ${className ?? ''}`}>
        <div className="balance-list__skeleton space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl bg-gray-800/50 px-4 py-3"
            >
              <div className="h-10 w-10 animate-pulse rounded-full bg-gray-700" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-20 animate-pulse rounded bg-gray-700" />
                <div className="h-3 w-32 animate-pulse rounded bg-gray-700" />
              </div>
              <div className="space-y-2 text-right">
                <div className="h-4 w-16 animate-pulse rounded bg-gray-700" />
                <div className="h-3 w-24 animate-pulse rounded bg-gray-700" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`balance-list ${className ?? ''}`}>
      {/* Search + controls */}
      <div className="balance-list__controls mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Search bar */}
        <div className="relative flex-1">
          <SearchIcon />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tokens..."
            className="w-full rounded-lg bg-gray-800 py-2 pl-9 pr-3 text-sm text-white placeholder-gray-500 outline-none ring-1 ring-gray-700 transition-colors focus:ring-blue-500"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="flex items-center gap-3">
          {/* Zero-balance toggle */}
          {zeroCount > 0 && (
            <button
              type="button"
              onClick={() => setShowZeroBalances(!showZeroBalances)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                showZeroBalances
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-300'
              }`}
            >
              {showZeroBalances ? 'Hide' : 'Show'} {zeroCount} zero
            </button>
          )}

          {/* Refresh button */}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-lg bg-gray-800 p-1.5 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
              aria-label="Refresh balances"
              title="Refresh"
            >
              <RefreshIcon />
            </button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {filteredBalances.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm text-gray-500">
            {search ? 'No tokens match your search' : 'No tokens found'}
          </p>
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="mt-2 text-xs text-blue-400 hover:text-blue-300"
            >
              Clear search
            </button>
          )}
        </div>
      )}

      {/* Token list */}
      {filteredBalances.length > 0 && (
        useVirtualization ? (
          <VirtualizedList
            balances={filteredBalances}
            priceChanges={priceChanges}
            btcRatios={btcRatios}
            onSelectToken={onSelectToken}
          />
        ) : (
          <ul className="balance-list__items space-y-2">
            {filteredBalances.map((balance) => (
              <li key={`${balance.chainId}-${balance.address}`}>
                <TokenRow
                  balance={balance}
                  priceChange24h={priceChanges?.get(balance.address.toLowerCase())}
                  btcRatio={btcRatios?.get(balance.address.toLowerCase())}
                  onSelect={onSelectToken}
                />
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Virtualized list for large token sets (>50)
// ────────────────────────────────────────────────────────────────

interface VirtualizedListProps {
  balances: TokenBalance[];
  priceChanges?: Map<string, number>;
  btcRatios?: Map<string, number>;
  onSelectToken?: (token: TokenBalance) => void;
}

/**
 * Lightweight virtualized list that only renders visible rows.
 * Uses a fixed row height and scroll-position-based rendering.
 * @internal
 */
function VirtualizedList({
  balances,
  priceChanges,
  btcRatios,
  onSelectToken,
}: VirtualizedListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = balances.length * ROW_HEIGHT;
  const containerHeight = 480; // max visible area
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_COUNT);
  const endIndex = Math.min(
    balances.length,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN_COUNT,
  );

  const visibleItems = balances.slice(startIndex, endIndex);

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="balance-list__virtual overflow-y-auto"
      style={{ height: containerHeight, maxHeight: containerHeight }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems.map((balance, i) => {
          const actualIndex = startIndex + i;
          return (
            <div
              key={`${balance.chainId}-${balance.address}`}
              style={{
                position: 'absolute',
                top: actualIndex * ROW_HEIGHT,
                left: 0,
                right: 0,
                height: ROW_HEIGHT,
              }}
              className="px-0 py-1"
            >
              <TokenRow
                balance={balance}
                priceChange24h={priceChanges?.get(balance.address.toLowerCase())}
                btcRatio={btcRatios?.get(balance.address.toLowerCase())}
                onSelect={onSelectToken}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Inline SVG icons
// ────────────────────────────────────────────────────────────────

/** @internal */
function SearchIcon() {
  return (
    <svg
      className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  );
}

/** @internal */
function RefreshIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}
