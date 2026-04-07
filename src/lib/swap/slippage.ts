/**
 * src/lib/swap/slippage.ts — Slippage calculation utilities
 *
 * Compute minimum output amounts, price impact severity,
 * auto-slippage estimation, and input validation.
 */

import type { SlippagePreset } from '../../types/swap';

/** Default slippage tolerance (0.5%) */
export const DEFAULT_SLIPPAGE: SlippagePreset = 0.5;

/** Slippage presets available in the UI */
export const SLIPPAGE_PRESETS: SlippagePreset[] = [0.1, 0.5, 1.0];

/** Maximum custom slippage allowed (50%) */
export const MAX_SLIPPAGE = 50;

/** Minimum custom slippage allowed (0.01%) */
export const MIN_SLIPPAGE = 0.01;

/** Default deadline in minutes */
export const DEFAULT_DEADLINE_MINUTES = 20;

/** Price impact severity thresholds (percentage) */
export const PRICE_IMPACT_THRESHOLDS = {
  LOW: 0.5,
  MEDIUM: 1,
  HIGH: 3,
  BLOCKED: 15,
} as const;

/** Price impact severity levels */
export type PriceImpactSeverity = 'low' | 'medium' | 'high' | 'blocked';

/**
 * Calculate the minimum amount received after slippage.
 * @param outputAmount - Expected output from the quote
 * @param slippagePercent - Slippage tolerance (e.g. 0.5 for 0.5%)
 */
export function calculateMinimumReceived(
  outputAmount: bigint,
  slippagePercent: number,
): bigint {
  const basisPoints = BigInt(Math.floor(slippagePercent * 100));
  const denominator = 10000n;
  return outputAmount - (outputAmount * basisPoints) / denominator;
}

/**
 * Calculate price impact as a percentage.
 * @param marketPrice - Current market price (output per input)
 * @param executionPrice - Execution price from the quote
 */
export function calculatePriceImpact(
  marketPrice: number,
  executionPrice: number,
): number {
  if (marketPrice === 0) return 0;
  return ((marketPrice - executionPrice) / marketPrice) * 100;
}

/**
 * Determine if a price impact is considered high.
 * @param impactPercent - Price impact percentage
 * @param threshold - Warning threshold (default 3%)
 */
export function isHighPriceImpact(impactPercent: number, threshold: number = 3): boolean {
  return Math.abs(impactPercent) > threshold;
}

/**
 * Classify price impact into severity levels for UI display.
 * - low: < 0.5%  (green)
 * - medium: 0.5% - 3%  (yellow)
 * - high: 3% - 15%  (orange, warn user)
 * - blocked: > 15%  (red, block execution)
 * @param impactPercent - Absolute price impact percentage
 */
export function getPriceImpactSeverity(impactPercent: number): PriceImpactSeverity {
  const abs = Math.abs(impactPercent);
  if (abs >= PRICE_IMPACT_THRESHOLDS.BLOCKED) return 'blocked';
  if (abs >= PRICE_IMPACT_THRESHOLDS.HIGH) return 'high';
  if (abs >= PRICE_IMPACT_THRESHOLDS.LOW) return 'medium';
  return 'low';
}

/**
 * Whether the price impact is so high that the swap should be blocked.
 * @param impactPercent - Absolute price impact percentage
 */
export function isPriceImpactBlocked(impactPercent: number): boolean {
  return Math.abs(impactPercent) >= PRICE_IMPACT_THRESHOLDS.BLOCKED;
}

/**
 * Validate a custom slippage value.
 * @param value - Slippage percentage to validate
 * @returns Error message, or null if valid
 */
export function validateSlippage(value: number): string | null {
  if (Number.isNaN(value) || value <= 0) return 'Slippage must be greater than 0';
  if (value < MIN_SLIPPAGE) return `Slippage must be at least ${MIN_SLIPPAGE}%`;
  if (value > MAX_SLIPPAGE) return `Slippage cannot exceed ${MAX_SLIPPAGE}%`;
  if (value > 5) return 'Warning: High slippage may result in a poor trade';
  return null;
}

/**
 * Estimate auto-slippage based on price impact and trade size.
 * Uses a conservative formula: base 0.5% + impact-proportional buffer.
 * Clamped between 0.1% and 5%.
 * @param priceImpact - Price impact percentage from the quote
 */
export function calculateAutoSlippage(priceImpact: number): number {
  const abs = Math.abs(priceImpact);
  // Base 0.5% + half the price impact as buffer
  const auto = 0.5 + abs * 0.5;
  return Math.min(Math.max(auto, 0.1), 5);
}

/**
 * Convert slippage percentage to basis points.
 * @param slippagePercent - e.g. 0.5 for 0.5%
 */
export function slippageToBps(slippagePercent: number): number {
  return Math.floor(slippagePercent * 100);
}

/**
 * Convert basis points to slippage percentage.
 * @param bps - e.g. 50 for 0.5%
 */
export function bpsToSlippage(bps: number): number {
  return bps / 100;
}
