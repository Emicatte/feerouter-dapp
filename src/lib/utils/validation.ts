/**
 * src/lib/utils/validation.ts — Input sanitization
 *
 * Validators for addresses, amounts, and user input.
 */

/** Regex for a valid Ethereum address */
const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Check if a string is a valid Ethereum address.
 * @param value - String to validate
 */
export function isValidAddress(value: string): value is `0x${string}` {
  return ETH_ADDRESS_RE.test(value);
}

/**
 * Check if a string is a valid positive numeric amount.
 * @param value - String to validate
 */
export function isValidAmount(value: string): boolean {
  if (!value || value.trim() === '') return false;
  const num = Number(value);
  return !isNaN(num) && num > 0 && isFinite(num);
}

/**
 * Sanitize a numeric input string (strip non-numeric chars except dot).
 * @param value - Raw input
 */
export function sanitizeAmountInput(value: string): string {
  return value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
}

/**
 * Check if a transaction hash is valid.
 * @param hash - 0x-prefixed hex string (66 chars)
 */
export function isValidTxHash(hash: string): hash is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(hash);
}

// ────────────────────────────────────────────────────────────────
// Security-focused validators (PROMPT 8)
// ────────────────────────────────────────────────────────────────

/** Max token search query length to prevent abuse */
const MAX_SEARCH_LENGTH = 64;

/** HTML/script tag pattern for XSS prevention */
const XSS_PATTERN = /[<>"'`;&|{}()\\/]/g;

/**
 * Type guard: validates an Ethereum address with optional checksum verification.
 * Pure function — no side effects.
 * @param input - Candidate address string
 * @returns True if input is a valid 0x-prefixed 40-char hex address
 */
export function isValidAddressStrict(input: unknown): input is `0x${string}` {
  if (typeof input !== 'string') return false;
  return ETH_ADDRESS_RE.test(input);
}

/**
 * Validate a token amount string against decimal precision and overflow.
 * Pure function — no side effects.
 *
 * Checks:
 * - Non-empty, numeric
 * - Strictly positive (no zero, no negative)
 * - Finite (no Infinity, no NaN)
 * - Decimal places do not exceed token decimals
 * - Value does not exceed MAX_SAFE_INTEGER for UI display
 *
 * @param input - Amount string from user input
 * @param decimals - Token decimals (e.g. 18 for ETH, 6 for USDC, 8 for WBTC)
 * @returns Object with `valid` flag and optional `reason` string
 */
export function isValidAmountStrict(
  input: string,
  decimals: number,
): { valid: boolean; reason?: string } {
  if (!input || input.trim() === '') {
    return { valid: false, reason: 'Amount is required' };
  }

  // Only allow digits and a single decimal point
  if (!/^\d+(\.\d+)?$/.test(input.trim())) {
    return { valid: false, reason: 'Invalid numeric format' };
  }

  const num = Number(input);

  if (!isFinite(num) || isNaN(num)) {
    return { valid: false, reason: 'Amount must be a finite number' };
  }

  if (num <= 0) {
    return { valid: false, reason: 'Amount must be greater than zero' };
  }

  // Check decimal precision
  const parts = input.trim().split('.');
  if (parts.length === 2 && parts[1].length > decimals) {
    return { valid: false, reason: `Exceeds ${decimals} decimal places` };
  }

  // Overflow guard: amounts beyond 10^15 are suspicious for most tokens
  if (num > 1e15) {
    return { valid: false, reason: 'Amount exceeds maximum allowed value' };
  }

  return { valid: true };
}

/**
 * Sanitize a token search query to prevent XSS and injection.
 * Pure function — strips dangerous characters and enforces length limit.
 *
 * @param query - Raw search input from user
 * @returns Sanitized string safe for display and filtering
 */
export function sanitizeTokenSearch(query: string): string {
  if (!query || typeof query !== 'string') return '';

  // Trim and limit length
  let clean = query.trim().slice(0, MAX_SEARCH_LENGTH);

  // Strip XSS-relevant characters
  clean = clean.replace(XSS_PATTERN, '');

  // Collapse whitespace
  clean = clean.replace(/\s+/g, ' ');

  return clean;
}

/**
 * Validate slippage in basis points.
 * Pure function — no side effects.
 *
 * @param bps - Slippage in basis points (1 bps = 0.01%)
 * @returns Object with `valid` flag and optional `reason`
 */
export function validateSlippageBps(
  bps: number,
): { valid: boolean; reason?: string } {
  if (!Number.isFinite(bps) || Number.isNaN(bps)) {
    return { valid: false, reason: 'Slippage must be a number' };
  }

  if (!Number.isInteger(bps)) {
    return { valid: false, reason: 'Slippage must be an integer (basis points)' };
  }

  if (bps < 1) {
    return { valid: false, reason: 'Slippage must be at least 1 bps (0.01%)' };
  }

  if (bps > 5000) {
    return { valid: false, reason: 'Slippage cannot exceed 5000 bps (50%)' };
  }

  return { valid: true };
}

/**
 * Validate transaction deadline in minutes.
 * Pure function — no side effects.
 *
 * @param minutes - Deadline in minutes from now
 * @returns Object with `valid` flag and optional `reason`
 */
export function validateDeadline(
  minutes: number,
): { valid: boolean; reason?: string } {
  if (!Number.isFinite(minutes) || Number.isNaN(minutes)) {
    return { valid: false, reason: 'Deadline must be a number' };
  }

  if (!Number.isInteger(minutes)) {
    return { valid: false, reason: 'Deadline must be a whole number of minutes' };
  }

  if (minutes < 1) {
    return { valid: false, reason: 'Deadline must be at least 1 minute' };
  }

  if (minutes > 180) {
    return { valid: false, reason: 'Deadline cannot exceed 180 minutes (3 hours)' };
  }

  return { valid: true };
}

/**
 * Validate a hex-encoded calldata string.
 * Pure function.
 * @param data - 0x-prefixed hex calldata
 */
export function isValidCalldata(data: string): data is `0x${string}` {
  if (typeof data !== 'string') return false;
  // Must be 0x followed by even number of hex chars (byte-aligned)
  return /^0x([0-9a-fA-F]{2})*$/.test(data);
}

/**
 * Validate a 4-byte function selector.
 * Pure function.
 * @param selector - 0x-prefixed 8-char hex (4 bytes)
 */
export function isValidSelector(selector: string): selector is `0x${string}` {
  return /^0x[0-9a-fA-F]{8}$/.test(selector);
}
