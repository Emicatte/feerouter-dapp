/**
 * src/__tests__/lib/tokens/wbtc.test.ts — WBTC token utility tests
 *
 * Tests 8-decimal conversions, cross-chain BTC variants,
 * bridge info, and peg tracking helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  WBTC_DECIMALS,
  WBTC_ADDRESSES,
  CBBTC_ADDRESSES,
  BTCB_ADDRESSES,
  isWBTC,
  isBtcWrapped,
  getWBTCForChain,
  getBtcTokenAddress,
  getWBTCBridgeInfo,
  formatWBTCAmount,
  parseWBTCAmount,
  convertDecimals,
  getWbtcTokens,
  hasLowLiquidity,
} from '../../../lib/tokens/wbtc';
import type { Token } from '../../../types/token';

/** Minimal Token factory */
function makeToken(overrides: Partial<Token> = {}): Token {
  return {
    address: '0x0000000000000000000000000000000000000001',
    chainId: 1,
    decimals: 18,
    symbol: 'TEST',
    name: 'Test Token',
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('WBTC uses 8 decimals', () => {
    expect(WBTC_DECIMALS).toBe(8);
  });

  it('has WBTC addresses for Ethereum, Optimism, Polygon, Arbitrum, Avalanche', () => {
    expect(WBTC_ADDRESSES[1]).toBeDefined();
    expect(WBTC_ADDRESSES[10]).toBeDefined();
    expect(WBTC_ADDRESSES[137]).toBeDefined();
    expect(WBTC_ADDRESSES[42161]).toBeDefined();
    expect(WBTC_ADDRESSES[43114]).toBeDefined();
  });

  it('has cbBTC address for Base (8453)', () => {
    expect(CBBTC_ADDRESSES[8453]).toBeDefined();
  });

  it('has BTCB address for BNB Chain (56)', () => {
    expect(BTCB_ADDRESSES[56]).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────
// isWBTC / isBtcWrapped
// ────────────────────────────────────────────────────────────────

describe('isWBTC / isBtcWrapped', () => {
  it('returns true for token with btc tag', () => {
    const t = makeToken({ tags: ['wrapped', 'btc'] });
    expect(isWBTC(t)).toBe(true);
    expect(isBtcWrapped(t)).toBe(true);
  });

  it('returns false without btc tag', () => {
    expect(isWBTC(makeToken({ tags: ['stablecoin'] }))).toBe(false);
  });

  it('returns false for no tags', () => {
    expect(isWBTC(makeToken())).toBe(false);
  });

  it('returns false for undefined tags', () => {
    expect(isWBTC(makeToken({ tags: undefined }))).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// getWBTCForChain
// ────────────────────────────────────────────────────────────────

describe('getWBTCForChain', () => {
  it('returns WBTC for Ethereum', () => {
    const t = getWBTCForChain(1);
    expect(t).not.toBeNull();
    expect(t!.symbol).toBe('WBTC');
    expect(t!.decimals).toBe(8);
  });

  it('returns null for chain without BTC variant in default list', () => {
    expect(getWBTCForChain(324)).toBeNull();
  });

  it('returns null for unknown chain', () => {
    expect(getWBTCForChain(99999)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// getBtcTokenAddress
// ────────────────────────────────────────────────────────────────

describe('getBtcTokenAddress', () => {
  it('returns WBTC address for Ethereum', () => {
    expect(getBtcTokenAddress(1)).toBe(WBTC_ADDRESSES[1]);
  });

  it('returns WBTC address for Arbitrum', () => {
    expect(getBtcTokenAddress(42161)).toBe(WBTC_ADDRESSES[42161]);
  });

  it('returns cbBTC address for Base', () => {
    expect(getBtcTokenAddress(8453)).toBe(CBBTC_ADDRESSES[8453]);
  });

  it('returns BTCB address for BNB Chain', () => {
    expect(getBtcTokenAddress(56)).toBe(BTCB_ADDRESSES[56]);
  });

  it('returns null for ZKsync (no BTC variant)', () => {
    expect(getBtcTokenAddress(324)).toBeNull();
  });

  it('returns null for unknown chain', () => {
    expect(getBtcTokenAddress(99999)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// getWBTCBridgeInfo
// ────────────────────────────────────────────────────────────────

describe('getWBTCBridgeInfo', () => {
  it('returns native bridge for Ethereum (BitGo)', () => {
    const info = getWBTCBridgeInfo(1);
    expect(info).not.toBeNull();
    expect(info!.bridgeType).toBe('native');
    expect(info!.bridgeName).toBe('BitGo');
  });

  it('returns bridged info for Arbitrum', () => {
    const info = getWBTCBridgeInfo(42161);
    expect(info).not.toBeNull();
    expect(info!.bridgeType).toBe('bridged');
    expect(info!.sourceChainId).toBe(1);
  });

  it('returns native for Base (Coinbase)', () => {
    const info = getWBTCBridgeInfo(8453);
    expect(info!.bridgeName).toBe('Coinbase');
    expect(info!.bridgeType).toBe('native');
  });

  it('returns null for unsupported chain', () => {
    expect(getWBTCBridgeInfo(99999)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// formatWBTCAmount / parseWBTCAmount — 8 decimal precision
// ────────────────────────────────────────────────────────────────

describe('formatWBTCAmount', () => {
  it('formats 1 WBTC (10^8)', () => {
    expect(formatWBTCAmount(100_000_000n)).toBe('1');
  });

  it('formats 0.5 WBTC', () => {
    expect(formatWBTCAmount(50_000_000n)).toBe('0.5');
  });

  it('formats zero', () => {
    expect(formatWBTCAmount(0n)).toBe('0');
  });

  it('formats 1 satoshi (smallest unit)', () => {
    expect(formatWBTCAmount(1n)).toBe('0.00000001');
  });

  it('uses custom decimals when specified', () => {
    expect(formatWBTCAmount(1_000_000_000_000_000_000n, 18)).toBe('1');
  });
});

describe('parseWBTCAmount', () => {
  it('parses "1" to 10^8', () => {
    expect(parseWBTCAmount('1')).toBe(100_000_000n);
  });

  it('parses "0.5"', () => {
    expect(parseWBTCAmount('0.5')).toBe(50_000_000n);
  });

  it('parses smallest unit', () => {
    expect(parseWBTCAmount('0.00000001')).toBe(1n);
  });

  it('round-trips with formatWBTCAmount', () => {
    const raw = parseWBTCAmount('0.5');
    expect(formatWBTCAmount(raw)).toBe('0.5');
  });

  it('uses custom decimals', () => {
    expect(parseWBTCAmount('1', 18)).toBe(1_000_000_000_000_000_000n);
  });
});

// ────────────────────────────────────────────────────────────────
// convertDecimals — cross-precision conversion
// ────────────────────────────────────────────────────────────────

describe('convertDecimals', () => {
  it('18 → 8 (ETH scale → WBTC scale)', () => {
    expect(convertDecimals(1_000_000_000_000_000_000n, 18, 8)).toBe(100_000_000n);
  });

  it('8 → 18 (WBTC scale → ETH scale)', () => {
    expect(convertDecimals(100_000_000n, 8, 18)).toBe(1_000_000_000_000_000_000n);
  });

  it('returns same when decimals equal', () => {
    expect(convertDecimals(12345n, 8, 8)).toBe(12345n);
  });

  it('6 → 18 (USDC → ETH scale)', () => {
    expect(convertDecimals(1_000_000n, 6, 18)).toBe(1_000_000_000_000_000_000n);
  });

  it('handles zero', () => {
    expect(convertDecimals(0n, 18, 8)).toBe(0n);
  });

  it('truncates without rounding when downscaling', () => {
    // 1.5 in 18-dec → 8-dec: 1_500_000_000_000_000_000 / 10^10 = 150_000_000
    expect(convertDecimals(1_500_000_000_000_000_000n, 18, 8)).toBe(150_000_000n);
  });

  it('truncates sub-unit precision when downscaling', () => {
    // 1 wei (18-dec) → 8-dec = 0 (less than 1 unit in 8-dec)
    expect(convertDecimals(1n, 18, 8)).toBe(0n);
  });
});

// ────────────────────────────────────────────────────────────────
// getWbtcTokens
// ────────────────────────────────────────────────────────────────

describe('getWbtcTokens', () => {
  it('returns non-empty array of btc-tagged tokens', () => {
    const tokens = getWbtcTokens();
    expect(tokens.length).toBeGreaterThan(0);
    tokens.forEach((t) => {
      expect(t.tags).toContain('btc');
    });
  });
});

// ────────────────────────────────────────────────────────────────
// hasLowLiquidity
// ────────────────────────────────────────────────────────────────

describe('hasLowLiquidity', () => {
  it('true for Avalanche (43114)', () => {
    expect(hasLowLiquidity(43114)).toBe(true);
  });

  it('false for Ethereum (1)', () => {
    expect(hasLowLiquidity(1)).toBe(false);
  });

  it('false for unknown chain', () => {
    expect(hasLowLiquidity(99999)).toBe(false);
  });
});
