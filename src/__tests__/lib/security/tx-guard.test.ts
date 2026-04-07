/**
 * src/__tests__/lib/security/tx-guard.test.ts — Transaction guard tests
 *
 * Tests all pre-flight security checks: zero address, whitelist,
 * balance, gas, selectors, approval detection, event logging.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkTransaction,
  isWhitelistedContract,
  guardTransaction,
  logSecurityEvent,
  getSecurityEvents,
  type TxCheckParams,
} from '../../../lib/security/tx-guard';
import { CONTRACT_ADDRESSES, ZERO_ADDRESS } from '../../../constants/addresses';
import type { SupportedChainId } from '../../../types/chain';

const CHAIN_ID: SupportedChainId = 1;
const ROUTER = CONTRACT_ADDRESSES[1].uniswapV3Router;
const UNKNOWN_ADDR = '0xDeaDBeeFDeaDBeeFDeaDBeeFDeaDBeeFDeaDBeEF' as `0x${string}`;

/** Known swap selector (exactInputSingle) */
const SWAP_SELECTOR = '0x414bf389';

/** ERC-20 approve selector */
const APPROVE_SELECTOR = '0x095ea7b3';

/** Build minimal TxCheckParams */
function makeTxParams(overrides: Partial<TxCheckParams> = {}): TxCheckParams {
  return {
    to: ROUTER,
    value: 0n,
    data: `${SWAP_SELECTOR}${'00'.repeat(128)}` as `0x${string}`,
    chainId: CHAIN_ID,
    senderBalance: 10n ** 18n, // 1 ETH
    ...overrides,
  };
}

/** Build approve(address,uint256) calldata */
function buildApproveCalldata(
  spender: string,
  amount: bigint,
): `0x${string}` {
  const spenderHex = spender.slice(2).toLowerCase().padStart(64, '0');
  const amountHex = amount.toString(16).padStart(64, '0');
  return `${APPROVE_SELECTOR}${spenderHex}${amountHex}` as `0x${string}`;
}

// ────────────────────────────────────────────────────────────────
// isWhitelistedContract
// ────────────────────────────────────────────────────────────────

describe('isWhitelistedContract', () => {
  it('true for Uniswap V3 Router', () => {
    expect(isWhitelistedContract(ROUTER, CHAIN_ID)).toBe(true);
  });

  it('true for Uniswap V3 Quoter', () => {
    expect(isWhitelistedContract(CONTRACT_ADDRESSES[1].uniswapV3Quoter, CHAIN_ID)).toBe(true);
  });

  it('true for Multicall3', () => {
    expect(isWhitelistedContract(CONTRACT_ADDRESSES[1].multicall3, CHAIN_ID)).toBe(true);
  });

  it('true for WETH', () => {
    expect(isWhitelistedContract(CONTRACT_ADDRESSES[1].weth, CHAIN_ID)).toBe(true);
  });

  it('false for unknown address', () => {
    expect(isWhitelistedContract(UNKNOWN_ADDR, CHAIN_ID)).toBe(false);
  });

  it('case-insensitive matching', () => {
    const lower = ROUTER.toLowerCase() as `0x${string}`;
    expect(isWhitelistedContract(lower, CHAIN_ID)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// checkTransaction
// ────────────────────────────────────────────────────────────────

describe('checkTransaction', () => {
  it('allows valid swap to whitelisted router', () => {
    const result = checkTransaction(makeTxParams());
    expect(result.allowed).toBe(true);
  });

  // ── Zero address ──────────────────────────────────────────
  it('blocks zero address target', () => {
    const result = checkTransaction(makeTxParams({ to: ZERO_ADDRESS }));
    expect(result.allowed).toBe(false);
    expect(result.findings.some((f) => f.code === 'ZERO_ADDRESS_TARGET')).toBe(true);
    expect(result.maxSeverity).toBe('block');
  });

  // ── Unknown contract ──────────────────────────────────────
  it('warns about unknown contract', () => {
    const result = checkTransaction(makeTxParams({
      to: UNKNOWN_ADDR,
      data: `${SWAP_SELECTOR}${'00'.repeat(128)}` as `0x${string}`,
    }));
    expect(result.findings.some((f) => f.code === 'UNKNOWN_CONTRACT')).toBe(true);
  });

  // ── Balance check ─────────────────────────────────────────
  it('blocks when value exceeds balance', () => {
    const result = checkTransaction(makeTxParams({
      value: 10n ** 19n,   // 10 ETH
      senderBalance: 10n ** 18n, // 1 ETH
    }));
    expect(result.allowed).toBe(false);
    expect(result.findings.some((f) => f.code === 'INSUFFICIENT_BALANCE')).toBe(true);
  });

  it('allows when balance is sufficient', () => {
    const result = checkTransaction(makeTxParams({
      value: 10n ** 17n,
      senderBalance: 10n ** 18n,
    }));
    expect(result.findings.some((f) => f.code === 'INSUFFICIENT_BALANCE')).toBe(false);
  });

  it('skips balance check when value is 0', () => {
    const result = checkTransaction(makeTxParams({
      value: 0n,
      senderBalance: 0n,
    }));
    expect(result.findings.some((f) => f.code === 'INSUFFICIENT_BALANCE')).toBe(false);
  });

  // ── Gas estimate ──────────────────────────────────────────
  it('reports danger for excessive gas (>5M)', () => {
    const result = checkTransaction(makeTxParams({ gasEstimate: 6_000_000n }));
    const finding = result.findings.find((f) => f.code === 'EXCESSIVE_GAS');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('danger');
  });

  it('allows gas under 5M', () => {
    const result = checkTransaction(makeTxParams({ gasEstimate: 200_000n }));
    expect(result.findings.some((f) => f.code === 'EXCESSIVE_GAS')).toBe(false);
  });

  // ── Function selector ─────────────────────────────────────
  it('info for unknown selector on whitelisted contract', () => {
    const result = checkTransaction(makeTxParams({
      data: `0xdeadbeef${'00'.repeat(128)}` as `0x${string}`,
    }));
    expect(result.findings.some((f) => f.code === 'UNKNOWN_SELECTOR')).toBe(true);
  });

  it('danger for unknown selector on unknown contract', () => {
    const result = checkTransaction(makeTxParams({
      to: UNKNOWN_ADDR,
      data: `0xdeadbeef${'00'.repeat(128)}` as `0x${string}`,
    }));
    expect(result.findings.some((f) => f.code === 'UNKNOWN_CONTRACT_AND_SELECTOR')).toBe(true);
  });

  // ── Approval checks ──────────────────────────────────────
  it('blocks unlimited approval to unknown contract', () => {
    const maxUint = 2n ** 256n - 1n;
    const data = buildApproveCalldata(UNKNOWN_ADDR, maxUint);
    const result = checkTransaction(makeTxParams({ to: UNKNOWN_ADDR, data }));
    expect(result.allowed).toBe(false);
    expect(result.findings.some((f) => f.code === 'UNLIMITED_APPROVAL_UNKNOWN')).toBe(true);
  });

  it('allows unlimited approval to whitelisted contract (info)', () => {
    const maxUint = 2n ** 256n - 1n;
    const data = buildApproveCalldata(ROUTER, maxUint);
    const result = checkTransaction(makeTxParams({ to: ROUTER, data }));
    const finding = result.findings.find((f) => f.code === 'UNLIMITED_APPROVAL_KNOWN');
    expect(finding?.severity).toBe('info');
    expect(result.allowed).toBe(true);
  });

  it('danger for suspiciously high approval to unknown', () => {
    const highAmount = 2n ** 129n;
    const data = buildApproveCalldata(UNKNOWN_ADDR, highAmount);
    const result = checkTransaction(makeTxParams({ to: UNKNOWN_ADDR, data }));
    expect(result.findings.some((f) => f.code === 'HIGH_APPROVAL_UNKNOWN')).toBe(true);
  });

  // ── maxSeverity ───────────────────────────────────────────
  it('computes maxSeverity across multiple findings', () => {
    const result = checkTransaction(makeTxParams({
      to: UNKNOWN_ADDR,
      data: `0xdeadbeef${'00'.repeat(128)}` as `0x${string}`,
    }));
    // UNKNOWN_CONTRACT (warning) + UNKNOWN_CONTRACT_AND_SELECTOR (danger)
    expect(result.maxSeverity).toBe('danger');
  });
});

// ────────────────────────────────────────────────────────────────
// guardTransaction — checkTransaction + logging
// ────────────────────────────────────────────────────────────────

describe('guardTransaction', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('returns same result as checkTransaction', () => {
    const params = makeTxParams();
    const check = checkTransaction(params);
    const guard = guardTransaction(params);
    expect(guard.allowed).toBe(check.allowed);
    expect(guard.findings.length).toBe(check.findings.length);
  });

  it('logs security events for blocking findings', () => {
    const before = getSecurityEvents().length;
    guardTransaction(makeTxParams({ to: ZERO_ADDRESS }));
    expect(getSecurityEvents().length).toBeGreaterThan(before);
  });
});

// ────────────────────────────────────────────────────────────────
// logSecurityEvent / getSecurityEvents
// ────────────────────────────────────────────────────────────────

describe('logSecurityEvent / getSecurityEvents', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('appends event to buffer', () => {
    const before = getSecurityEvents().length;
    logSecurityEvent({
      type: 'TX_WARNING',
      code: 'TEST_CODE',
      chainId: 1,
      contractAddress: UNKNOWN_ADDR,
      timestamp: Date.now(),
    });
    expect(getSecurityEvents().length).toBe(before + 1);
  });

  it('returns a copy (not internal buffer)', () => {
    const events = getSecurityEvents();
    const originalLength = events.length;
    events.push({
      type: 'TX_BLOCKED',
      code: 'FAKE',
      chainId: 1,
      contractAddress: '0x',
      timestamp: 0,
    });
    // Internal buffer unaffected
    expect(getSecurityEvents().length).toBe(originalLength);
  });
});
