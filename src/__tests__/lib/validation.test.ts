/**
 * Unit tests — Input validation (addresses, amounts, deadlines, tx hashes)
 *
 * These validators are the gateway between user input and on-chain actions.
 * A false positive could send funds to an invalid address.
 */

import { describe, it, expect } from 'vitest'
import {
  isValidAddress,
  isValidAmount,
  sanitizeAmountInput,
  isValidTxHash,
  isValidAddressStrict,
  isValidAmountStrict,
  sanitizeTokenSearch,
  validateSlippageBps,
  validateDeadline,
  isValidCalldata,
  isValidSelector,
} from '../../lib/utils/validation'

// ── Address validation ────────────────────────────────────────────

describe('isValidAddress (EVM)', () => {
  it('accepts valid checksummed address', () => {
    expect(isValidAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(true)
  })

  it('accepts uppercase hex', () => {
    expect(isValidAddress('0xABCDEF1234567890ABCDEF1234567890ABCDEF12')).toBe(true)
  })

  it('rejects missing 0x prefix', () => {
    expect(isValidAddress('1234567890abcdef1234567890abcdef12345678')).toBe(false)
  })

  it('rejects too short', () => {
    expect(isValidAddress('0x1234')).toBe(false)
  })

  it('rejects too long', () => {
    expect(isValidAddress('0x1234567890abcdef1234567890abcdef123456789')).toBe(false)
  })

  it('rejects non-hex characters', () => {
    expect(isValidAddress('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG')).toBe(false)
  })

  it('rejects Tron address', () => {
    expect(isValidAddress('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb')).toBe(false)
  })

  it('rejects Solana address', () => {
    expect(isValidAddress('7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv')).toBe(false)
  })
})

// ── Chain-specific address patterns (EVM adapter, Tron adapter) ───

describe('chain-specific address validation', () => {
  const evmRegex = /^0x[0-9a-fA-F]{40}$/
  const tronRegex = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

  it('EVM: accepts zero address', () => {
    expect(evmRegex.test('0x0000000000000000000000000000000000000000')).toBe(true)
  })

  it('Tron: valid T-address', () => {
    expect(tronRegex.test('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb')).toBe(true)
  })

  it('Tron: rejects 0x address', () => {
    expect(tronRegex.test('0x1234567890abcdef1234567890abcdef12345678')).toBe(false)
  })

  it('Tron: rejects address starting with non-T', () => {
    expect(tronRegex.test('A9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb')).toBe(false)
  })
})

// ── Amount validation ─────────────────────────────────────────────

describe('isValidAmount', () => {
  it('positive number is valid', () => {
    expect(isValidAmount('1.5')).toBe(true)
  })

  it('zero is invalid', () => {
    expect(isValidAmount('0')).toBe(false)
  })

  it('negative is invalid', () => {
    expect(isValidAmount('-1')).toBe(false)
  })

  it('empty string is invalid', () => {
    expect(isValidAmount('')).toBe(false)
  })

  it('non-numeric is invalid', () => {
    expect(isValidAmount('abc')).toBe(false)
  })
})

describe('isValidAmountStrict', () => {
  it('rejects too many decimals for USDC (6)', () => {
    const r = isValidAmountStrict('1.1234567', 6)
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('6 decimal')
  })

  it('accepts correct decimals for USDC', () => {
    expect(isValidAmountStrict('1.123456', 6).valid).toBe(true)
  })

  it('rejects too many decimals for WBTC (8)', () => {
    expect(isValidAmountStrict('0.123456789', 8).valid).toBe(false)
  })

  it('accepts 18 decimal places for ETH', () => {
    expect(isValidAmountStrict('0.000000000000000001', 18).valid).toBe(true)
  })

  it('rejects amounts > 10^15', () => {
    const r = isValidAmountStrict('9999999999999999', 18)
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('maximum')
  })

  it('rejects zero', () => {
    expect(isValidAmountStrict('0', 18).valid).toBe(false)
  })

  it('rejects empty', () => {
    expect(isValidAmountStrict('', 18).valid).toBe(false)
  })

  it('rejects non-numeric', () => {
    expect(isValidAmountStrict('abc', 18).valid).toBe(false)
  })
})

// ── Amount sanitization ───────────────────────────────────────────

describe('sanitizeAmountInput', () => {
  it('strips letters', () => {
    expect(sanitizeAmountInput('12.5abc')).toBe('12.5')
  })

  it('keeps only first decimal point', () => {
    expect(sanitizeAmountInput('12.5.6')).toBe('12.56')
  })

  it('strips special characters', () => {
    expect(sanitizeAmountInput('$100,000.50')).toBe('100000.50')
  })
})

// ── Tx hash validation ────────────────────────────────────────────

describe('isValidTxHash', () => {
  it('valid 66-char hash', () => {
    const hash = '0x' + 'a'.repeat(64)
    expect(isValidTxHash(hash)).toBe(true)
  })

  it('rejects too short', () => {
    expect(isValidTxHash('0x1234')).toBe(false)
  })

  it('rejects no 0x prefix', () => {
    expect(isValidTxHash('a'.repeat(64))).toBe(false)
  })
})

// ── Token search sanitization (XSS prevention) ───────────────────

describe('sanitizeTokenSearch', () => {
  it('strips HTML tags', () => {
    expect(sanitizeTokenSearch('<script>alert(1)</script>')).toBe('scriptalert1script')
  })

  it('strips special chars', () => {
    expect(sanitizeTokenSearch('USDC; DROP TABLE')).toBe('USDC DROP TABLE')
  })

  it('truncates to 64 chars', () => {
    const long = 'A'.repeat(100)
    expect(sanitizeTokenSearch(long).length).toBeLessThanOrEqual(64)
  })

  it('returns empty for null-ish', () => {
    expect(sanitizeTokenSearch('')).toBe('')
  })
})

// ── Slippage BPS validation ───────────────────────────────────────

describe('validateSlippageBps', () => {
  it('50 bps (0.5%) is valid', () => {
    expect(validateSlippageBps(50).valid).toBe(true)
  })

  it('0 bps is invalid', () => {
    expect(validateSlippageBps(0).valid).toBe(false)
  })

  it('5001 bps (50.01%) is invalid', () => {
    expect(validateSlippageBps(5001).valid).toBe(false)
  })

  it('non-integer is invalid', () => {
    expect(validateSlippageBps(50.5).valid).toBe(false)
  })

  it('NaN is invalid', () => {
    expect(validateSlippageBps(NaN).valid).toBe(false)
  })
})

// ── Deadline validation ───────────────────────────────────────────

describe('validateDeadline', () => {
  it('20 minutes is valid', () => {
    expect(validateDeadline(20).valid).toBe(true)
  })

  it('0 minutes is invalid', () => {
    expect(validateDeadline(0).valid).toBe(false)
  })

  it('181 minutes is invalid', () => {
    expect(validateDeadline(181).valid).toBe(false)
  })

  it('1 minute (boundary) is valid', () => {
    expect(validateDeadline(1).valid).toBe(true)
  })

  it('180 minutes (boundary) is valid', () => {
    expect(validateDeadline(180).valid).toBe(true)
  })

  it('non-integer is invalid', () => {
    expect(validateDeadline(5.5).valid).toBe(false)
  })
})

// ── Calldata / selector validation ────────────────────────────────

describe('isValidCalldata', () => {
  it('empty calldata 0x is valid', () => {
    expect(isValidCalldata('0x')).toBe(true)
  })

  it('valid 4-byte selector', () => {
    expect(isValidCalldata('0xa9059cbb')).toBe(true)
  })

  it('rejects odd-length hex', () => {
    expect(isValidCalldata('0xabc')).toBe(false)
  })
})

describe('isValidSelector', () => {
  it('valid ERC-20 transfer selector', () => {
    expect(isValidSelector('0xa9059cbb')).toBe(true)
  })

  it('rejects too short', () => {
    expect(isValidSelector('0xa905')).toBe(false)
  })
})
