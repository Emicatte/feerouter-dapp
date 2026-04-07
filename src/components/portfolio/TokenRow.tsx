/**
 * src/components/portfolio/TokenRow.tsx — Single token balance row
 *
 * Displays token icon, name, symbol, balance, USD value,
 * 24h price change, click-to-swap action, and WBTC BTC equivalent.
 */

'use client';

import { useCallback } from 'react';
import type { TokenBalance } from '../../types/token';
import { formatBalance, formatUsd } from '../../lib/utils/format';

/** TokenRow props */
export interface TokenRowProps {
  balance: TokenBalance;
  /** 24h price change percentage (e.g. 2.5 for +2.5%) */
  priceChange24h?: number | null;
  /** BTC equivalent ratio for WBTC-like tokens (e.g. 0.9998) */
  btcRatio?: number;
  /** Callback when row is clicked (e.g. navigate to swap with this token) */
  onSelect?: (token: TokenBalance) => void;
  className?: string;
}

/**
 * Determine display decimals based on token type and value.
 * @internal
 */
function getDisplayDecimals(symbol: string, usdValue: number | null): number {
  const upper = symbol.toUpperCase();
  // Stablecoins: 2 decimals
  if (['USDC', 'USDT', 'DAI', 'USDB'].includes(upper)) return 2;
  // BTC tokens: 6 decimals
  if (['WBTC', 'CBBTC', 'BTCB', 'BTC'].includes(upper)) return 6;
  // Small value tokens: more decimals
  if (usdValue !== null && usdValue < 0.01) return 6;
  return 4;
}

/**
 * Single row in the portfolio balance list.
 *
 * Features:
 * - Token icon with fallback initial
 * - Balance formatted with appropriate decimals
 * - USD value display
 * - 24h price change (green/red arrow)
 * - WBTC: shows BTC equivalent
 * - Click → triggers onSelect for swap navigation
 */
export function TokenRow({
  balance,
  priceChange24h,
  btcRatio,
  onSelect,
  className,
}: TokenRowProps) {
  const displayDecimals = getDisplayDecimals(balance.symbol, balance.usdValue);
  const formattedBal = formatBalance(parseFloat(balance.formattedBalance), displayDecimals);
  const usdDisplay = balance.usdValue !== null ? formatUsd(balance.usdValue) : '\u2014';

  const isBtcToken = balance.tags?.includes('btc');
  const hasChange = priceChange24h != null && priceChange24h !== 0;
  const isPositive = hasChange && priceChange24h! > 0;
  const isNegative = hasChange && priceChange24h! < 0;

  const handleClick = useCallback(() => {
    onSelect?.(balance);
  }, [onSelect, balance]);

  return (
    <div
      className={`token-row flex items-center justify-between rounded-xl bg-gray-800/50 px-4 py-3 transition-colors ${
        onSelect ? 'cursor-pointer hover:bg-gray-700/50' : ''
      } ${className ?? ''}`}
      onClick={onSelect ? handleClick : undefined}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
    >
      {/* Left: icon + name */}
      <div className="token-row__left flex items-center gap-3">
        {/* Token icon */}
        <div className="token-row__icon relative h-10 w-10 flex-shrink-0">
          {balance.logoURI ? (
            <img
              src={balance.logoURI}
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 rounded-full"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-600 text-sm font-bold text-white">
              {balance.symbol.slice(0, 2)}
            </div>
          )}
        </div>

        {/* Token name + symbol */}
        <div className="token-row__info flex flex-col">
          <span className="text-sm font-semibold text-white">
            {balance.symbol}
          </span>
          <span className="text-xs text-gray-400">
            {balance.name}
          </span>
        </div>
      </div>

      {/* Right: balance + USD + 24h change */}
      <div className="token-row__right flex flex-col items-end gap-0.5">
        {/* USD value */}
        <span className="text-sm font-semibold text-white">
          {usdDisplay}
        </span>

        {/* Token balance */}
        <span className="text-xs text-gray-400">
          {formattedBal} {balance.symbol}
        </span>

        {/* 24h price change */}
        {hasChange && (
          <span
            className={`flex items-center gap-0.5 text-xs font-medium ${
              isPositive ? 'text-green-400' : isNegative ? 'text-red-400' : 'text-gray-500'
            }`}
          >
            {isPositive && (
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            )}
            {isNegative && (
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            )}
            {isPositive ? '+' : ''}{priceChange24h!.toFixed(2)}%
          </span>
        )}

        {/* WBTC: BTC equivalent */}
        {isBtcToken && btcRatio != null && (
          <span className="text-xs text-orange-400">
            {btcRatio.toFixed(4)} BTC peg
          </span>
        )}
      </div>
    </div>
  );
}
