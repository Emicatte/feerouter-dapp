/**
 * src/components/swap/PriceImpact.tsx — Price impact indicator
 *
 * Displays the price impact with severity-based color coding:
 * - low (<0.5%): green
 * - medium (0.5%-3%): yellow + warning
 * - high (3%-15%): orange + strong warning
 * - blocked (>15%): red + block indicator
 */

'use client';

import {
  isHighPriceImpact,
  getPriceImpactSeverity,
  isPriceImpactBlocked,
  type PriceImpactSeverity,
} from '../../lib/swap/slippage';

/** PriceImpact props */
export interface PriceImpactProps {
  impactPercent: number;
  className?: string;
}

/** Human-readable labels per severity */
const SEVERITY_LABELS: Record<PriceImpactSeverity, string> = {
  low: '',
  medium: 'Warning: moderate price impact',
  high: 'Warning: high price impact!',
  blocked: 'Price impact too high \u2014 swap blocked',
};

/**
 * Price impact display with severity coloring.
 */
export function PriceImpact({ impactPercent, className }: PriceImpactProps) {
  const isHigh = isHighPriceImpact(impactPercent);
  const severity = getPriceImpactSeverity(impactPercent);
  const isBlocked = isPriceImpactBlocked(impactPercent);
  const formatted = `${Math.abs(impactPercent).toFixed(2)}%`;
  const label = SEVERITY_LABELS[severity];

  return (
    <div
      className={`price-impact ${className ?? ''}`}
      data-severity={severity}
    >
      <div className="price-impact__row">
        <span className="price-impact__label">Price Impact</span>
        <span
          className="price-impact__value"
          data-severity={isHigh ? 'high' : 'low'}
        >
          {impactPercent < 0 ? '-' : ''}
          {formatted}
        </span>
      </div>
      {label && (
        <div className="price-impact__warning" role="alert">
          {isBlocked ? '\u26D4' : '\u26A0\uFE0F'} {label}
        </div>
      )}
    </div>
  );
}
