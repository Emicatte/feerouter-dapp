/**
 * src/__tests__/lib/swap/slippage.test.ts — Slippage calculation tests
 *
 * Tests BigInt calculations, decimal precision, severity classification,
 * auto-slippage estimation, and BPS conversion round-trips.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateMinimumReceived,
  calculatePriceImpact,
  isHighPriceImpact,
  getPriceImpactSeverity,
  isPriceImpactBlocked,
  validateSlippage,
  calculateAutoSlippage,
  slippageToBps,
  bpsToSlippage,
  DEFAULT_SLIPPAGE,
  SLIPPAGE_PRESETS,
  MAX_SLIPPAGE,
  MIN_SLIPPAGE,
  DEFAULT_DEADLINE_MINUTES,
  PRICE_IMPACT_THRESHOLDS,
} from '../../../lib/swap/slippage';

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('has expected defaults', () => {
    expect(DEFAULT_SLIPPAGE).toBe(0.5);
    expect(SLIPPAGE_PRESETS).toEqual([0.1, 0.5, 1.0]);
    expect(MAX_SLIPPAGE).toBe(50);
    expect(MIN_SLIPPAGE).toBe(0.01);
    expect(DEFAULT_DEADLINE_MINUTES).toBe(20);
  });

  it('has expected price impact thresholds', () => {
    expect(PRICE_IMPACT_THRESHOLDS.LOW).toBe(0.5);
    expect(PRICE_IMPACT_THRESHOLDS.MEDIUM).toBe(1);
    expect(PRICE_IMPACT_THRESHOLDS.HIGH).toBe(3);
    expect(PRICE_IMPACT_THRESHOLDS.BLOCKED).toBe(15);
  });
});

// ────────────────────────────────────────────────────────────────
// calculateMinimumReceived — BigInt arithmetic
// ────────────────────────────────────────────────────────────────

describe('calculateMinimumReceived', () => {
  it('applies 0.5% slippage (50 bps)', () => {
    // 1 USDC = 1_000_000. 0.5% → floor(0.5*100) = 50 bps
    // result = 1_000_000 - (1_000_000 * 50 / 10_000) = 995_000
    expect(calculateMinimumReceived(1_000_000n, 0.5)).toBe(995_000n);
  });

  it('applies 1% slippage (100 bps)', () => {
    expect(calculateMinimumReceived(10_000n, 1)).toBe(9_900n);
  });

  it('returns full amount for 0% slippage', () => {
    expect(calculateMinimumReceived(1_000_000n, 0)).toBe(1_000_000n);
  });

  it('handles 1 ETH (18 decimals) with 0.5% slippage', () => {
    const oneEth = 1_000_000_000_000_000_000n;
    expect(calculateMinimumReceived(oneEth, 0.5)).toBe(995_000_000_000_000_000n);
  });

  it('handles zero output', () => {
    expect(calculateMinimumReceived(0n, 0.5)).toBe(0n);
  });

  it('handles 50% slippage', () => {
    expect(calculateMinimumReceived(10_000n, 50)).toBe(5_000n);
  });

  it('truncates fractional bps (0.15% → floor(15) = 15 bps)', () => {
    // 10_000 - (10_000 * 15 / 10_000) = 10_000 - 15 = 9_985
    expect(calculateMinimumReceived(10_000n, 0.15)).toBe(9_985n);
  });

  it('handles very large amounts (100 BTC in 8-dec)', () => {
    const hundredBtc = 10_000_000_000n; // 100 * 10^8
    const result = calculateMinimumReceived(hundredBtc, 0.5);
    // 10_000_000_000 - 50_000_000 = 9_950_000_000
    expect(result).toBe(9_950_000_000n);
  });
});

// ────────────────────────────────────────────────────────────────
// calculatePriceImpact
// ────────────────────────────────────────────────────────────────

describe('calculatePriceImpact', () => {
  it('returns 0 when prices are equal', () => {
    expect(calculatePriceImpact(100, 100)).toBe(0);
  });

  it('returns positive impact when execution price is lower', () => {
    expect(calculatePriceImpact(100, 97)).toBeCloseTo(3, 5);
  });

  it('returns negative impact when execution price is higher', () => {
    expect(calculatePriceImpact(100, 103)).toBeCloseTo(-3, 5);
  });

  it('returns 0 when market price is 0 (avoid div-by-zero)', () => {
    expect(calculatePriceImpact(0, 100)).toBe(0);
  });

  it('handles small differences (<0.1%)', () => {
    expect(calculatePriceImpact(1000, 999.5)).toBeCloseTo(0.05, 2);
  });
});

// ────────────────────────────────────────────────────────────────
// isHighPriceImpact
// ────────────────────────────────────────────────────────────────

describe('isHighPriceImpact', () => {
  it('returns false below default threshold (3%)', () => {
    expect(isHighPriceImpact(2)).toBe(false);
  });

  it('returns false at exactly 3%', () => {
    expect(isHighPriceImpact(3)).toBe(false);
  });

  it('returns true above 3%', () => {
    expect(isHighPriceImpact(3.01)).toBe(true);
  });

  it('uses custom threshold', () => {
    expect(isHighPriceImpact(2, 1)).toBe(true);
    expect(isHighPriceImpact(0.5, 1)).toBe(false);
  });

  it('uses absolute value for negative impact', () => {
    expect(isHighPriceImpact(-5)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// getPriceImpactSeverity
// ────────────────────────────────────────────────────────────────

describe('getPriceImpactSeverity', () => {
  it('low for < 0.5%', () => {
    expect(getPriceImpactSeverity(0.3)).toBe('low');
    expect(getPriceImpactSeverity(0)).toBe('low');
  });

  it('medium at exactly 0.5%', () => {
    expect(getPriceImpactSeverity(0.5)).toBe('medium');
  });

  it('medium between 0.5% and 3%', () => {
    expect(getPriceImpactSeverity(1)).toBe('medium');
    expect(getPriceImpactSeverity(2.99)).toBe('medium');
  });

  it('high at exactly 3%', () => {
    expect(getPriceImpactSeverity(3)).toBe('high');
  });

  it('high between 3% and 15%', () => {
    expect(getPriceImpactSeverity(5)).toBe('high');
    expect(getPriceImpactSeverity(14.99)).toBe('high');
  });

  it('blocked at >= 15%', () => {
    expect(getPriceImpactSeverity(15)).toBe('blocked');
    expect(getPriceImpactSeverity(20)).toBe('blocked');
  });

  it('uses absolute value for negatives', () => {
    expect(getPriceImpactSeverity(-5)).toBe('high');
    expect(getPriceImpactSeverity(-15)).toBe('blocked');
  });
});

// ────────────────────────────────────────────────────────────────
// isPriceImpactBlocked
// ────────────────────────────────────────────────────────────────

describe('isPriceImpactBlocked', () => {
  it('false below 15%', () => {
    expect(isPriceImpactBlocked(14.99)).toBe(false);
  });

  it('true at 15%', () => {
    expect(isPriceImpactBlocked(15)).toBe(true);
  });

  it('true above 15%', () => {
    expect(isPriceImpactBlocked(20)).toBe(true);
  });

  it('uses absolute value', () => {
    expect(isPriceImpactBlocked(-15)).toBe(true);
    expect(isPriceImpactBlocked(-14)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// validateSlippage
// ────────────────────────────────────────────────────────────────

describe('validateSlippage', () => {
  it('returns null for valid slippage (0.5%)', () => {
    expect(validateSlippage(0.5)).toBeNull();
  });

  it('returns null for preset values', () => {
    for (const preset of SLIPPAGE_PRESETS) {
      expect(validateSlippage(preset)).toBeNull();
    }
  });

  it('returns error for NaN', () => {
    expect(validateSlippage(NaN)).toContain('greater than 0');
  });

  it('returns error for zero', () => {
    expect(validateSlippage(0)).toContain('greater than 0');
  });

  it('returns error for negative', () => {
    expect(validateSlippage(-1)).toContain('greater than 0');
  });

  it('returns error below MIN_SLIPPAGE', () => {
    expect(validateSlippage(0.001)).toContain('at least');
  });

  it('returns error above MAX_SLIPPAGE', () => {
    expect(validateSlippage(51)).toContain('exceed');
  });

  it('returns warning for high but valid (>5%)', () => {
    expect(validateSlippage(10)).toContain('Warning');
  });

  it('returns null for exactly 5%', () => {
    expect(validateSlippage(5)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// calculateAutoSlippage
// ────────────────────────────────────────────────────────────────

describe('calculateAutoSlippage', () => {
  it('returns 0.5% base for zero impact', () => {
    expect(calculateAutoSlippage(0)).toBeCloseTo(0.5, 5);
  });

  it('increases with price impact', () => {
    expect(calculateAutoSlippage(5)).toBeGreaterThan(calculateAutoSlippage(1));
  });

  it('clamps to minimum 0.1%', () => {
    expect(calculateAutoSlippage(0)).toBeGreaterThanOrEqual(0.1);
  });

  it('clamps to maximum 5%', () => {
    expect(calculateAutoSlippage(100)).toBe(5);
  });

  it('handles negative impact (uses abs)', () => {
    expect(calculateAutoSlippage(-2)).toBe(calculateAutoSlippage(2));
  });

  it('formula: 0.5 + impact×0.5 for moderate impact', () => {
    // impact = 2 → auto = 0.5 + 1 = 1.5
    expect(calculateAutoSlippage(2)).toBeCloseTo(1.5, 5);
  });
});

// ────────────────────────────────────────────────────────────────
// slippageToBps / bpsToSlippage round-trips
// ────────────────────────────────────────────────────────────────

describe('slippageToBps / bpsToSlippage', () => {
  it('converts 0.5% → 50 bps', () => {
    expect(slippageToBps(0.5)).toBe(50);
  });

  it('converts 1% → 100 bps', () => {
    expect(slippageToBps(1)).toBe(100);
  });

  it('converts 50 bps → 0.5%', () => {
    expect(bpsToSlippage(50)).toBe(0.5);
  });

  it('round-trips all presets', () => {
    for (const preset of SLIPPAGE_PRESETS) {
      expect(bpsToSlippage(slippageToBps(preset))).toBe(preset);
    }
  });

  it('floors fractional bps (0.1% = 10 bps exactly)', () => {
    expect(slippageToBps(0.1)).toBe(10);
  });
});
