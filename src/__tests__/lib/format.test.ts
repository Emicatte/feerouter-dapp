/**
 * Unit tests — Format utilities (formatBalance, formatUsd, truncateAddress, formatGwei)
 *
 * Display-only but important: wrong formatting can confuse users
 * about how much they're sending.
 */

import { describe, it, expect } from 'vitest'
import {
  formatBalance,
  formatUsd,
  formatEur,
  formatGwei,
  truncateAddress,
} from '../../lib/utils/format'

describe('formatBalance', () => {
  it('formats with default 4 decimals', () => {
    const result = formatBalance(1234.56789)
    // en-US locale: "1,234.5679"
    expect(result).toContain('1,234')
    expect(result).toContain('5679')
  })

  it('pads small numbers to 2 minimum decimals', () => {
    const result = formatBalance(1)
    expect(result).toBe('1.00')
  })

  it('respects custom decimal count', () => {
    const result = formatBalance(1.123456789, 8)
    expect(result).toContain('1.12345679')
  })

  it('handles zero', () => {
    expect(formatBalance(0)).toBe('0.00')
  })

  it('formats large numbers with comma separator', () => {
    const result = formatBalance(1000000)
    expect(result).toContain('1,000,000')
  })
})

describe('formatUsd', () => {
  it('formats as USD currency', () => {
    const result = formatUsd(1234.5)
    expect(result).toContain('$')
    expect(result).toContain('1,234.50')
  })

  it('rounds to 2 decimal places', () => {
    const result = formatUsd(99.999)
    expect(result).toContain('$')
    // 99.999 rounds to 100.00
    expect(result).toContain('100.00')
  })

  it('handles zero', () => {
    const result = formatUsd(0)
    expect(result).toContain('$')
    expect(result).toContain('0.00')
  })
})

describe('formatEur', () => {
  it('formats as EUR currency', () => {
    const result = formatEur(500)
    expect(result).toContain('500.00')
    // EUR symbol varies by locale implementation
  })
})

describe('formatGwei', () => {
  it('converts wei to Gwei', () => {
    // 30 Gwei = 30_000_000_000 wei
    const result = formatGwei(30_000_000_000n)
    expect(result).toBe('30.0 Gwei')
  })

  it('handles sub-Gwei amounts', () => {
    const result = formatGwei(500_000_000n) // 0.5 Gwei
    expect(result).toBe('0.5 Gwei')
  })

  it('handles zero', () => {
    expect(formatGwei(0n)).toBe('0.0 Gwei')
  })
})

describe('truncateAddress', () => {
  it('truncates long address with default chars=4', () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678'
    const result = truncateAddress(addr)
    expect(result).toBe('0x1234\u20265678')
  })

  it('returns short addresses unchanged', () => {
    expect(truncateAddress('0x1234')).toBe('0x1234')
  })

  it('respects custom char count', () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678'
    const result = truncateAddress(addr, 6)
    expect(result).toBe('0x123456\u2026345678')
  })
})
