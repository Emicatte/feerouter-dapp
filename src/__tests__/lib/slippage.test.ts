/**
 * Unit tests — Slippage calculations
 *
 * Validates minimum received amounts, auto-slippage estimation,
 * price impact severity, and slippage validation rules.
 */

import { describe, it, expect } from 'vitest'
import {
  calculateMinimumReceived,
  calculatePriceImpact,
  getPriceImpactSeverity,
  isPriceImpactBlocked,
  validateSlippage,
  calculateAutoSlippage,
  slippageToBps,
  bpsToSlippage,
  DEFAULT_SLIPPAGE,
  MAX_SLIPPAGE,
  MIN_SLIPPAGE,
} from '../../lib/swap/slippage'

describe('calculateMinimumReceived', () => {
  it('0.5% slippage on 1000 tokens → 995', () => {
    // 1000 tokens in smallest unit
    const output = 1_000_000_000n // e.g. 1000 USDC (6 dec)
    const min = calculateMinimumReceived(output, 0.5)
    // 0.5% = 50 bps → deduction = 1_000_000_000 * 50 / 10_000 = 5_000_000
    expect(min).toBe(995_000_000n)
  })

  it('1% slippage on 1 ETH', () => {
    const oneETH = 1_000_000_000_000_000_000n
    const min = calculateMinimumReceived(oneETH, 1.0)
    // 1% = 100 bps → deduction = 10_000_000_000_000_000
    expect(min).toBe(990_000_000_000_000_000n)
  })

  it('0 slippage returns exact amount', () => {
    const amount = 500n
    expect(calculateMinimumReceived(amount, 0)).toBe(500n)
  })

  it('small amounts round down (no fractional wei)', () => {
    // 3 * 50 / 10000 = 0 (integer division) → min = 3
    expect(calculateMinimumReceived(3n, 0.5)).toBe(3n)
  })
})

describe('calculatePriceImpact', () => {
  it('no impact when prices match', () => {
    expect(calculatePriceImpact(100, 100)).toBe(0)
  })

  it('positive impact when execution is worse', () => {
    // market=100, execution=95 → 5% impact
    expect(calculatePriceImpact(100, 95)).toBe(5)
  })

  it('returns 0 when market price is 0', () => {
    expect(calculatePriceImpact(0, 100)).toBe(0)
  })
})

describe('getPriceImpactSeverity', () => {
  it('< 0.5% → low', () => {
    expect(getPriceImpactSeverity(0.3)).toBe('low')
  })

  it('0.5% → medium', () => {
    expect(getPriceImpactSeverity(0.5)).toBe('medium')
  })

  it('3% → high', () => {
    expect(getPriceImpactSeverity(3)).toBe('high')
  })

  it('15% → blocked', () => {
    expect(getPriceImpactSeverity(15)).toBe('blocked')
  })

  it('negative values use abs', () => {
    expect(getPriceImpactSeverity(-20)).toBe('blocked')
  })
})

describe('isPriceImpactBlocked', () => {
  it('14.9% → not blocked', () => {
    expect(isPriceImpactBlocked(14.9)).toBe(false)
  })

  it('15% → blocked', () => {
    expect(isPriceImpactBlocked(15)).toBe(true)
  })
})

describe('validateSlippage', () => {
  it('0.5% is valid (no warning)', () => {
    expect(validateSlippage(0.5)).toBeNull()
  })

  it('0 is rejected', () => {
    expect(validateSlippage(0)).toBe('Slippage must be greater than 0')
  })

  it('NaN is rejected', () => {
    expect(validateSlippage(NaN)).toBe('Slippage must be greater than 0')
  })

  it('below MIN_SLIPPAGE is rejected', () => {
    expect(validateSlippage(0.001)).toBe(`Slippage must be at least ${MIN_SLIPPAGE}%`)
  })

  it('above MAX_SLIPPAGE is rejected', () => {
    expect(validateSlippage(51)).toBe(`Slippage cannot exceed ${MAX_SLIPPAGE}%`)
  })

  it('> 5% returns warning (not null)', () => {
    expect(validateSlippage(6)).toBe('Warning: High slippage may result in a poor trade')
  })

  it('5% is valid (boundary)', () => {
    expect(validateSlippage(5)).toBeNull()
  })
})

describe('calculateAutoSlippage', () => {
  it('0% impact → base 0.5%', () => {
    expect(calculateAutoSlippage(0)).toBe(0.5)
  })

  it('2% impact → 0.5 + 1 = 1.5%', () => {
    expect(calculateAutoSlippage(2)).toBe(1.5)
  })

  it('clamped to max 5%', () => {
    expect(calculateAutoSlippage(100)).toBe(5)
  })

  it('negative impact uses abs', () => {
    expect(calculateAutoSlippage(-2)).toBe(1.5)
  })

  it('never below 0.1%', () => {
    // 0.5 + 0*0.5 = 0.5 > 0.1, so this case is 0.5
    // But clamp logic: Math.max(auto, 0.1)
    expect(calculateAutoSlippage(0)).toBeGreaterThanOrEqual(0.1)
  })
})

describe('slippageToBps / bpsToSlippage', () => {
  it('0.5% → 50 bps', () => {
    expect(slippageToBps(0.5)).toBe(50)
  })

  it('50 bps → 0.5%', () => {
    expect(bpsToSlippage(50)).toBe(0.5)
  })

  it('round-trip', () => {
    expect(bpsToSlippage(slippageToBps(1.0))).toBe(1.0)
  })
})

describe('constants', () => {
  it('DEFAULT_SLIPPAGE is 0.5', () => {
    expect(DEFAULT_SLIPPAGE).toBe(0.5)
  })

  it('MAX_SLIPPAGE is 50', () => {
    expect(MAX_SLIPPAGE).toBe(50)
  })
})
