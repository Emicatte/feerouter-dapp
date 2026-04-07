/**
 * src/components/wallet/ChainSelector.tsx — Chain switching dropdown
 *
 * Full-featured chain selector with search/filter, keyboard navigation,
 * current-chain indicator, "wrong network" warning, and animated dropdown.
 */

'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  getSupportedChains,
  isSupportedChain,
  MAINNET_CHAIN_IDS,
} from '../../config/chains';
import type { SupportedChainId } from '../../types/chain';
import type { EVMChain } from '../../types/chain';

/** Chain-specific Tailwind bg colors for the indicator dot */
const CHAIN_DOT_COLORS: Record<number, string> = {
  1: 'bg-blue-500',
  10: 'bg-red-500',
  56: 'bg-yellow-500',
  137: 'bg-purple-500',
  324: 'bg-indigo-400',
  8453: 'bg-blue-600',
  42161: 'bg-sky-500',
  42220: 'bg-emerald-500',
  43114: 'bg-red-600',
  81457: 'bg-yellow-300',
  84532: 'bg-blue-400',
};

/** ChainSelector props */
export interface ChainSelectorProps {
  /** Currently active chain ID */
  currentChainId: number;
  /** Called when the user selects a chain */
  onSelect: (chainId: SupportedChainId) => void;
  /** Disable the selector (e.g. during switch) */
  disabled?: boolean;
  /** Whether a switch is in progress (shows loading) */
  isSwitching?: boolean;
  /** Additional CSS class names */
  className?: string;
}

/**
 * Checkmark SVG icon.
 * @internal
 */
function CheckIcon() {
  return (
    <svg
      className="h-4 w-4 text-green-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

/**
 * Chevron SVG icon for the dropdown trigger.
 * @internal
 */
function ChevronIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 9l-7 7-7-7"
      />
    </svg>
  );
}

/**
 * Inline warning icon.
 * @internal
 */
function WarningIcon() {
  return (
    <svg
      className="h-4 w-4 text-amber-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}

/**
 * Chain selector dropdown component.
 *
 * Features:
 * - Dropdown with colored dot + chain name
 * - Checkmark on the currently active chain
 * - "Wrong network" indicator if on unsupported chain
 * - Search/filter input for 10+ chains
 * - Keyboard navigation (ArrowUp/Down, Enter, Escape)
 * - Animated open/close via CSS transition
 */
export function ChainSelector({
  currentChainId,
  onSelect,
  disabled,
  isSwitching,
  className,
}: ChainSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isWrongNetwork = currentChainId > 0 && !isSupportedChain(currentChainId);
  const allChains = useMemo(() => getSupportedChains(), []);

  /** Filtered chains based on search input */
  const filteredChains = useMemo(() => {
    if (!search.trim()) return allChains;
    const q = search.toLowerCase();
    return allChains.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.shortName.toLowerCase().includes(q) ||
        String(c.id).includes(q),
    );
  }, [allChains, search]);

  /** Reset highlight when filtered list changes */
  useEffect(() => {
    setHighlightIndex(0);
  }, [filteredChains.length]);

  /** Focus search input when dropdown opens */
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure the element is visible
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setSearch('');
    }
  }, [isOpen]);

  /** Close on click outside */
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  /** Keyboard navigation */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightIndex((i) =>
            Math.min(i + 1, filteredChains.length - 1),
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredChains[highlightIndex]) {
            handleSelect(filteredChains[highlightIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    },
    [filteredChains, highlightIndex],
  );

  /** Handle chain selection */
  const handleSelect = useCallback(
    (chain: EVMChain) => {
      if (chain.id === currentChainId) {
        setIsOpen(false);
        return;
      }
      onSelect(chain.id as SupportedChainId);
      setIsOpen(false);
    },
    [currentChainId, onSelect],
  );

  /** Scroll highlighted item into view */
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-chain-item]');
    items[highlightIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, isOpen]);

  /** Current chain display */
  const currentChain = allChains.find((c) => c.id === currentChainId);
  const dotColor =
    CHAIN_DOT_COLORS[currentChainId] ?? 'bg-gray-500';

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        disabled={disabled}
        className={[
          'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium',
          'transition-all hover:scale-[1.02] active:scale-[0.98]',
          isWrongNetwork
            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
            : 'bg-gray-800 text-white hover:bg-gray-700',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        ].join(' ')}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {isSwitching ? (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : isWrongNetwork ? (
          <WarningIcon />
        ) : (
          <span className={`inline-block h-3 w-3 rounded-full ${dotColor}`} />
        )}
        <span className="hidden sm:inline">
          {isWrongNetwork
            ? 'Wrong Network'
            : currentChain?.shortName ?? `Chain ${currentChainId}`}
        </span>
        <ChevronIcon isOpen={isOpen} />
      </button>

      {/* Dropdown */}
      <div
        className={[
          'absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl',
          'border border-gray-700 bg-gray-900 shadow-xl',
          'transition-all duration-200 origin-top-right',
          isOpen
            ? 'opacity-100 scale-100'
            : 'opacity-0 scale-95 pointer-events-none',
        ].join(' ')}
        role="listbox"
        aria-label="Select chain"
        onKeyDown={handleKeyDown}
      >
        {/* Search */}
        <div className="border-b border-gray-800 p-2">
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chains..."
            className="w-full rounded-lg bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
            aria-label="Filter chains"
          />
        </div>

        {/* Wrong network banner */}
        {isWrongNetwork && (
          <div className="flex items-center gap-2 border-b border-gray-800 bg-amber-500/10 px-3 py-2">
            <WarningIcon />
            <span className="text-xs text-amber-300">
              Connected to an unsupported network. Please switch.
            </span>
          </div>
        )}

        {/* Chain list */}
        <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
          {filteredChains.length > 0 ? (
            filteredChains.map((chain, index) => {
              const isActive = chain.id === currentChainId;
              const isHighlighted = index === highlightIndex;
              const color = CHAIN_DOT_COLORS[chain.id] ?? 'bg-gray-500';

              return (
                <button
                  key={chain.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  data-chain-item
                  onClick={() => handleSelect(chain)}
                  onMouseEnter={() => setHighlightIndex(index)}
                  disabled={disabled || isSwitching}
                  className={[
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm',
                    'transition-colors',
                    isHighlighted ? 'bg-gray-800' : '',
                    isActive ? 'text-white' : 'text-gray-300',
                    disabled || isSwitching
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-gray-800',
                  ].join(' ')}
                >
                  <span
                    className={`inline-block h-3 w-3 flex-shrink-0 rounded-full ${color}`}
                  />
                  <span className="flex-1 text-left">
                    {chain.name}
                    {chain.testnet && (
                      <span className="ml-1 text-xs text-gray-500">
                        (testnet)
                      </span>
                    )}
                  </span>
                  {isActive && <CheckIcon />}
                </button>
              );
            })
          ) : (
            <div className="px-3 py-4 text-center text-sm text-gray-500">
              No chains match &ldquo;{search}&rdquo;
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

ChainSelector.displayName = 'ChainSelector';
