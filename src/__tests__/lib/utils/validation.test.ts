/**
 * src/__tests__/lib/utils/validation.test.ts — Validation utilities
 *
 * Tests every exported function with edge cases.
 */

import { describe, it, expect } from 'vitest';
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
} from '../../../lib/utils/validation';
import {
  truncateAddress,
  formatBalance,
  formatUsd,
  formatEur,
  formatGwei,
} from '../../../lib/utils/format';

// ────────────────────────────────────────────────────────────────
// isValidAddress
// ────────────────────────────────────────────────────────────────

describe('isValidAddress', () => {
  it('accepts valid lowercase address', () => {
    expect(isValidAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(true);
  });

  it('accepts valid mixed-case address', () => {
    expect(isValidAddress('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12')).toBe(true);
  });

  it('rejects address without 0x prefix', () => {
    expect(isValidAddress('1234567890abcdef1234567890abcdef12345678')).toBe(false);
  });

  it('rejects short address', () => {
    expect(isValidAddress('0x1234')).toBe(false);
  });

  it('rejects long address (41 hex chars)', () => {
    expect(isValidAddress('0x' + 'a'.repeat(41))).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isValidAddress('0x' + 'G'.repeat(40))).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidAddress('')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// isValidAmount
// ────────────────────────────────────────────────────────────────

describe('isValidAmount', () => {
  it('accepts positive integer', () => {
    expect(isValidAmount('10')).toBe(true);
  });

  it('accepts positive decimal', () => {
    expect(isValidAmount('0.5')).toBe(true);
  });

  it('accepts large number', () => {
    expect(isValidAmount('1000000')).toBe(true);
  });

  it('rejects zero', () => {
    expect(isValidAmount('0')).toBe(false);
  });

  it('rejects negative', () => {
    expect(isValidAmount('-1')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidAmount('')).toBe(false);
  });

  it('rejects whitespace only', () => {
    expect(isValidAmount('   ')).toBe(false);
  });

  it('rejects NaN string', () => {
    expect(isValidAmount('abc')).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(isValidAmount('Infinity')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// sanitizeAmountInput
// ────────────────────────────────────────────────────────────────

describe('sanitizeAmountInput', () => {
  it('preserves valid numeric input', () => {
    expect(sanitizeAmountInput('123.45')).toBe('123.45');
  });

  it('strips letters', () => {
    expect(sanitizeAmountInput('12a3b')).toBe('123');
  });

  it('strips currency symbols', () => {
    expect(sanitizeAmountInput('$100,000')).toBe('100000');
  });

  it('keeps only first decimal point', () => {
    expect(sanitizeAmountInput('1.2.3')).toBe('1.23');
  });

  it('strips negative sign', () => {
    expect(sanitizeAmountInput('-10')).toBe('10');
  });

  it('returns empty for empty input', () => {
    expect(sanitizeAmountInput('')).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────
// isValidTxHash
// ────────────────────────────────────────────────────────────────

describe('isValidTxHash', () => {
  it('accepts valid 66-char hash', () => {
    expect(isValidTxHash('0x' + 'a'.repeat(64))).toBe(true);
  });

  it('rejects short hash (63 hex)', () => {
    expect(isValidTxHash('0x' + 'a'.repeat(63))).toBe(false);
  });

  it('rejects long hash (65 hex)', () => {
    expect(isValidTxHash('0x' + 'a'.repeat(65))).toBe(false);
  });

  it('rejects without 0x prefix', () => {
    expect(isValidTxHash('a'.repeat(64))).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isValidTxHash('0x' + 'g'.repeat(64))).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// isValidAddressStrict
// ────────────────────────────────────────────────────────────────

describe('isValidAddressStrict', () => {
  it('accepts valid address string', () => {
    expect(isValidAddressStrict('0x1234567890abcdef1234567890abcdef12345678')).toBe(true);
  });

  it('rejects number', () => {
    expect(isValidAddressStrict(123)).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidAddressStrict(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidAddressStrict(undefined)).toBe(false);
  });

  it('rejects boolean', () => {
    expect(isValidAddressStrict(true)).toBe(false);
  });

  it('rejects object', () => {
    expect(isValidAddressStrict({})).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// isValidAmountStrict
// ────────────────────────────────────────────────────────────────

describe('isValidAmountStrict', () => {
  it('accepts valid amount within decimals', () => {
    expect(isValidAmountStrict('1.5', 18)).toEqual({ valid: true });
  });

  it('accepts integer amount', () => {
    expect(isValidAmountStrict('100', 6)).toEqual({ valid: true });
  });

  it('rejects empty input', () => {
    expect(isValidAmountStrict('', 18).valid).toBe(false);
  });

  it('rejects whitespace-only', () => {
    expect(isValidAmountStrict('   ', 18).valid).toBe(false);
  });

  it('rejects non-numeric', () => {
    const result = isValidAmountStrict('abc', 18);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Invalid numeric format');
  });

  it('rejects negative amounts', () => {
    expect(isValidAmountStrict('-5', 18).valid).toBe(false);
  });

  it('rejects zero', () => {
    const result = isValidAmountStrict('0', 18);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('greater than zero');
  });

  it('rejects excess decimals for USDC (6)', () => {
    const result = isValidAmountStrict('1.1234567', 6);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('6 decimal');
  });

  it('rejects excess decimals for WBTC (8)', () => {
    const result = isValidAmountStrict('0.123456789', 8);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('8 decimal');
  });

  it('accepts exact decimal count', () => {
    expect(isValidAmountStrict('1.123456', 6)).toEqual({ valid: true });
  });

  it('rejects amounts exceeding overflow guard', () => {
    const result = isValidAmountStrict('9999999999999999', 18);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('maximum');
  });

  it('accepts amount at boundary (10^15)', () => {
    expect(isValidAmountStrict('999999999999999', 18)).toEqual({ valid: true });
  });
});

// ────────────────────────────────────────────────────────────────
// sanitizeTokenSearch
// ────────────────────────────────────────────────────────────────

describe('sanitizeTokenSearch', () => {
  it('strips script tags', () => {
    const result = sanitizeTokenSearch('<script>alert("xss")</script>');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });

  it('strips angle brackets and quotes', () => {
    expect(sanitizeTokenSearch('token"name<>')).toBe('tokenname');
  });

  it('enforces max length (64)', () => {
    expect(sanitizeTokenSearch('a'.repeat(100)).length).toBeLessThanOrEqual(64);
  });

  it('collapses whitespace', () => {
    expect(sanitizeTokenSearch('hello   world')).toBe('hello world');
  });

  it('trims leading/trailing whitespace', () => {
    expect(sanitizeTokenSearch('  ETH  ')).toBe('ETH');
  });

  it('returns empty for empty string', () => {
    expect(sanitizeTokenSearch('')).toBe('');
  });

  it('returns empty for non-string input', () => {
    expect(sanitizeTokenSearch(null as unknown as string)).toBe('');
  });

  it('preserves valid token symbol', () => {
    expect(sanitizeTokenSearch('WBTC')).toBe('WBTC');
  });

  it('preserves hex address characters', () => {
    expect(sanitizeTokenSearch('0x1234abcd')).toBe('0x1234abcd');
  });
});

// ────────────────────────────────────────────────────────────────
// validateSlippageBps
// ────────────────────────────────────────────────────────────────

describe('validateSlippageBps', () => {
  it('accepts valid integer bps', () => {
    expect(validateSlippageBps(50)).toEqual({ valid: true });
  });

  it('accepts minimum (1 bps)', () => {
    expect(validateSlippageBps(1)).toEqual({ valid: true });
  });

  it('accepts maximum (5000 bps)', () => {
    expect(validateSlippageBps(5000)).toEqual({ valid: true });
  });

  it('rejects 0 bps', () => {
    expect(validateSlippageBps(0).valid).toBe(false);
  });

  it('rejects negative', () => {
    expect(validateSlippageBps(-10).valid).toBe(false);
  });

  it('rejects over 5000', () => {
    expect(validateSlippageBps(5001).valid).toBe(false);
  });

  it('rejects non-integer', () => {
    expect(validateSlippageBps(1.5).valid).toBe(false);
  });

  it('rejects NaN', () => {
    expect(validateSlippageBps(NaN).valid).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(validateSlippageBps(Infinity).valid).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// validateDeadline
// ────────────────────────────────────────────────────────────────

describe('validateDeadline', () => {
  it('accepts valid deadline', () => {
    expect(validateDeadline(20)).toEqual({ valid: true });
  });

  it('accepts minimum (1 minute)', () => {
    expect(validateDeadline(1)).toEqual({ valid: true });
  });

  it('accepts maximum (180 minutes)', () => {
    expect(validateDeadline(180)).toEqual({ valid: true });
  });

  it('rejects 0', () => {
    expect(validateDeadline(0).valid).toBe(false);
  });

  it('rejects negative', () => {
    expect(validateDeadline(-5).valid).toBe(false);
  });

  it('rejects over 180', () => {
    expect(validateDeadline(181).valid).toBe(false);
  });

  it('rejects non-integer', () => {
    expect(validateDeadline(5.5).valid).toBe(false);
  });

  it('rejects NaN', () => {
    expect(validateDeadline(NaN).valid).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// isValidCalldata
// ────────────────────────────────────────────────────────────────

describe('isValidCalldata', () => {
  it('accepts empty calldata (0x)', () => {
    expect(isValidCalldata('0x')).toBe(true);
  });

  it('accepts byte-aligned calldata', () => {
    expect(isValidCalldata('0xabcdef12')).toBe(true);
  });

  it('rejects odd-length hex (not byte-aligned)', () => {
    expect(isValidCalldata('0xabc')).toBe(false);
  });

  it('rejects without 0x prefix', () => {
    expect(isValidCalldata('abcdef')).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isValidCalldata('0xGGGG')).toBe(false);
  });

  it('rejects non-string', () => {
    expect(isValidCalldata(123 as unknown as string)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// isValidSelector
// ────────────────────────────────────────────────────────────────

describe('isValidSelector', () => {
  it('accepts valid 4-byte selector', () => {
    expect(isValidSelector('0x095ea7b3')).toBe(true);
  });

  it('rejects too-short selector', () => {
    expect(isValidSelector('0x095ea7')).toBe(false);
  });

  it('rejects too-long selector', () => {
    expect(isValidSelector('0x095ea7b3aa')).toBe(false);
  });

  it('rejects without 0x prefix', () => {
    expect(isValidSelector('095ea7b3')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
// format.ts — troncamento indirizzi, formattazione amounts
// ════════════════════════════════════════════════════════════════

describe('truncateAddress', () => {
  it('truncates standard address to default 4 chars', () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    expect(truncateAddress(addr)).toBe('0x1234…5678');
  });

  it('truncates with custom char count', () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    expect(truncateAddress(addr, 6)).toBe('0x123456…345678');
  });

  it('returns short string unchanged', () => {
    expect(truncateAddress('0x12')).toBe('0x12');
  });
});

describe('formatBalance', () => {
  it('formats integer with 2 decimals minimum', () => {
    expect(formatBalance(100)).toBe('100.00');
  });

  it('formats decimal with up to 4 places', () => {
    const result = formatBalance(1.23456789);
    expect(result).toMatch(/1\.234[56]/);
  });

  it('formats with custom decimal places', () => {
    const result = formatBalance(1.123456789, 8);
    expect(result).toContain('1.12345');
  });

  it('formats zero', () => {
    expect(formatBalance(0)).toBe('0.00');
  });

  it('formats large number with comma grouping', () => {
    const result = formatBalance(1000000);
    expect(result).toContain('1,000,000');
  });
});

describe('formatUsd', () => {
  it('formats USD with $ sign and 2 decimals', () => {
    expect(formatUsd(1234.5)).toBe('$1,234.50');
  });

  it('formats small amount', () => {
    expect(formatUsd(0.01)).toBe('$0.01');
  });

  it('formats zero', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });
});

describe('formatEur', () => {
  it('formats EUR with symbol and 2 decimals', () => {
    const result = formatEur(1234.5);
    expect(result).toContain('1,234.50');
  });
});

describe('formatGwei', () => {
  it('formats wei to Gwei', () => {
    expect(formatGwei(30000000000n)).toBe('30.0 Gwei');
  });

  it('formats zero', () => {
    expect(formatGwei(0n)).toBe('0.0 Gwei');
  });

  it('formats fractional Gwei', () => {
    expect(formatGwei(1500000000n)).toBe('1.5 Gwei');
  });
});
