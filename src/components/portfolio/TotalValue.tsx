/**
 * src/components/portfolio/TotalValue.tsx — Portfolio total value
 *
 * Displays the total USD value of all token holdings with:
 * - Animated counter on value change
 * - 24h change indicator (green/red with arrow)
 * - Skeleton loader during initial load
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { formatUsd } from '../../lib/utils/format';

/** TotalValue props */
export interface TotalValueProps {
  totalUsd: number | null;
  isLoading: boolean;
  /** 24h change in USD (positive = gain, negative = loss) */
  change24h?: number | null;
  /** 24h change as percentage */
  change24hPercent?: number | null;
  className?: string;
}

/** Animation duration in ms */
const ANIMATION_DURATION = 600;

/** Number of animation frames */
const ANIMATION_FRAMES = 30;

/**
 * Display the total portfolio value with animated counter
 * and optional 24h change indicator.
 */
export function TotalValue({
  totalUsd,
  isLoading,
  change24h,
  change24hPercent,
  className,
}: TotalValueProps) {
  const [displayValue, setDisplayValue] = useState(totalUsd ?? 0);
  const prevValueRef = useRef(totalUsd ?? 0);
  const animFrameRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animate value change
  const animateValue = useCallback((from: number, to: number) => {
    if (animFrameRef.current) clearTimeout(animFrameRef.current);

    const diff = to - from;
    if (Math.abs(diff) < 0.01) {
      setDisplayValue(to);
      return;
    }

    const stepDuration = ANIMATION_DURATION / ANIMATION_FRAMES;
    let frame = 0;

    function step() {
      frame++;
      // Ease-out cubic
      const progress = frame / ANIMATION_FRAMES;
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + diff * eased;

      setDisplayValue(current);

      if (frame < ANIMATION_FRAMES) {
        animFrameRef.current = setTimeout(step, stepDuration);
      } else {
        setDisplayValue(to);
      }
    }

    step();
  }, []);

  useEffect(() => {
    if (totalUsd === null) return;

    const prev = prevValueRef.current;
    prevValueRef.current = totalUsd;

    if (prev !== totalUsd) {
      animateValue(prev, totalUsd);
    }

    return () => {
      if (animFrameRef.current) clearTimeout(animFrameRef.current);
    };
  }, [totalUsd, animateValue]);

  // Skeleton loader
  if (isLoading) {
    return (
      <div className={`total-value ${className ?? ''}`}>
        <p className="total-value__label text-xs font-medium uppercase tracking-wider text-gray-400">
          Total Value
        </p>
        <div className="total-value__skeleton mt-2 h-10 w-48 animate-pulse rounded-lg bg-gray-700" />
        <div className="mt-2 h-4 w-24 animate-pulse rounded bg-gray-700" />
      </div>
    );
  }

  const hasChange = change24h != null && change24hPercent != null;
  const isPositive = hasChange && change24h! >= 0;
  const isNegative = hasChange && change24h! < 0;

  return (
    <div className={`total-value ${className ?? ''}`}>
      <p className="total-value__label text-xs font-medium uppercase tracking-wider text-gray-400">
        Total Value
      </p>
      <p className="total-value__amount mt-1 text-3xl font-bold text-white">
        {totalUsd !== null ? formatUsd(displayValue) : '\u2014'}
      </p>

      {hasChange && (
        <div
          className={`total-value__change mt-1 flex items-center gap-1 text-sm font-medium ${
            isPositive ? 'text-green-400' : isNegative ? 'text-red-400' : 'text-gray-400'
          }`}
        >
          {/* Arrow indicator */}
          {isPositive && (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          )}
          {isNegative && (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
          <span>
            {isPositive ? '+' : ''}{formatUsd(change24h!)}
          </span>
          <span className="text-gray-500">
            ({isPositive ? '+' : ''}{change24hPercent!.toFixed(2)}%)
          </span>
        </div>
      )}
    </div>
  );
}
