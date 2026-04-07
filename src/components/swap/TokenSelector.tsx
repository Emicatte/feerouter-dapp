/**
 * src/components/swap/TokenSelector.tsx — Token selection modal
 *
 * Searchable list of tokens with balance display, popular tokens section,
 * balance-sorted ordering, and address-based on-chain resolve for imports.
 */

'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { Token } from '../../types/token';
import type { TokenBalance } from '../../types/token';

/** Popular token symbols shown at top of list */
const POPULAR_SYMBOLS = ['ETH', 'WBTC', 'USDC', 'USDT', 'DAI'];

/** TokenSelector props */
export interface TokenSelectorProps {
  tokens: Token[];
  balances?: TokenBalance[];
  selectedToken: Token | null;
  onSelect: (token: Token) => void;
  isOpen: boolean;
  onClose: () => void;
  onImportToken?: (address: `0x${string}`) => void;
}

/**
 * Token selector modal with search, popular tokens, and balance sorting.
 */
export function TokenSelector({
  tokens,
  balances,
  selectedToken,
  onSelect,
  isOpen,
  onClose,
  onImportToken,
}: TokenSelectorProps) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search input when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build balance lookup map
  const balanceMap = useMemo(() => {
    if (!balances) return new Map<string, TokenBalance>();
    const map = new Map<string, TokenBalance>();
    for (const b of balances) {
      map.set(b.address.toLowerCase(), b);
    }
    return map;
  }, [balances]);

  // Filtered and sorted token list
  const filteredTokens = useMemo(() => {
    const q = search.trim().toLowerCase();
    const isAddressSearch = q.startsWith('0x') && q.length >= 10;

    let filtered = tokens;
    if (q) {
      filtered = tokens.filter((t) => {
        if (isAddressSearch) {
          return t.address.toLowerCase().startsWith(q);
        }
        return (
          t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q)
        );
      });
    }

    // Sort: tokens with balance > 0 first, then alphabetical
    return [...filtered].sort((a, b) => {
      const balA = balanceMap.get(a.address.toLowerCase())?.balance ?? 0n;
      const balB = balanceMap.get(b.address.toLowerCase())?.balance ?? 0n;

      if (balA > 0n && balB === 0n) return -1;
      if (balA === 0n && balB > 0n) return 1;
      if (balA > 0n && balB > 0n) {
        // Sort by USD value if available, otherwise by balance
        const usdA = balanceMap.get(a.address.toLowerCase())?.usdValue ?? 0;
        const usdB = balanceMap.get(b.address.toLowerCase())?.usdValue ?? 0;
        if (usdA !== usdB) return (usdB ?? 0) - (usdA ?? 0);
      }
      return a.symbol.localeCompare(b.symbol);
    });
  }, [tokens, search, balanceMap]);

  // Popular tokens subset
  const popularTokens = useMemo(() => {
    return tokens.filter((t) =>
      POPULAR_SYMBOLS.includes(t.symbol.toUpperCase()),
    );
  }, [tokens]);

  // Check if search looks like an unknown address
  const isUnknownAddress = useMemo(() => {
    if (!search.startsWith('0x') || search.length < 42) return false;
    return filteredTokens.length === 0;
  }, [search, filteredTokens]);

  const handleSelect = useCallback(
    (token: Token) => {
      onSelect(token);
      onClose();
    },
    [onSelect, onClose],
  );

  const handleImport = useCallback(() => {
    if (onImportToken && search.length === 42 && search.startsWith('0x')) {
      onImportToken(search as `0x${string}`);
    }
  }, [onImportToken, search]);

  if (!isOpen) return null;

  return (
    <div className="token-selector__overlay" onClick={onClose}>
      <div
        className="token-selector"
        role="dialog"
        aria-modal="true"
        aria-label="Select a token"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="token-selector__header">
          <h3>Select Token</h3>
          <button
            type="button"
            onClick={onClose}
            className="token-selector__close"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="token-selector__search">
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, symbol, or paste address"
            className="token-selector__search-input"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Popular tokens (chips) */}
        {!search && popularTokens.length > 0 && (
          <div className="token-selector__popular">
            {popularTokens.map((t) => (
              <button
                key={`popular-${t.chainId}-${t.address}`}
                type="button"
                onClick={() => handleSelect(t)}
                className="token-selector__chip"
                disabled={selectedToken?.address === t.address}
              >
                {t.logoURI && (
                  <img src={t.logoURI} alt="" width={20} height={20} />
                )}
                {t.symbol}
              </button>
            ))}
          </div>
        )}

        {/* Token list */}
        <ul className="token-selector__list">
          {filteredTokens.map((token) => {
            const bal = balanceMap.get(token.address.toLowerCase());
            const isSelected = selectedToken?.address === token.address;

            return (
              <li key={`${token.chainId}-${token.address}`}>
                <button
                  type="button"
                  onClick={() => handleSelect(token)}
                  className="token-selector__item"
                  aria-pressed={isSelected}
                  disabled={isSelected}
                >
                  <div className="token-selector__item-left">
                    {token.logoURI && (
                      <img
                        src={token.logoURI}
                        alt=""
                        width={32}
                        height={32}
                        className="token-selector__item-icon"
                      />
                    )}
                    <div>
                      <span className="token-selector__item-symbol">
                        {token.symbol}
                      </span>
                      <span className="token-selector__item-name">
                        {token.name}
                      </span>
                    </div>
                  </div>
                  <div className="token-selector__item-right">
                    {bal && bal.balance > 0n && (
                      <span className="token-selector__item-balance">
                        {Number(bal.formattedBalance).toFixed(4)}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}

          {filteredTokens.length === 0 && !isUnknownAddress && (
            <li className="token-selector__empty">No tokens found</li>
          )}

          {isUnknownAddress && (
            <li className="token-selector__import">
              <p>Token not in default list.</p>
              {onImportToken && (
                <button
                  type="button"
                  onClick={handleImport}
                  className="token-selector__import-btn"
                >
                  Import token (unverified)
                </button>
              )}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
