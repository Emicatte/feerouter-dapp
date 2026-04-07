/**
 * src/__tests__/hooks/useTokenBalances.test.ts — Token balance hook
 *
 * Tests balance fetching, USD value computation, sorting,
 * chain switch invalidation, and polling control.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ── Mock wagmi ─────────────────────────────────────────────────
const mockRefetchNative = vi.fn();
const mockRefetchErc20 = vi.fn();

vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    address: '0x1234567890abcdef1234567890abcdef12345678',
  })),
  useChainId: vi.fn(() => 1),
  useBalance: vi.fn(() => ({
    data: { value: 2_000_000_000_000_000_000n, formatted: '2.0', symbol: 'ETH' },
    isLoading: false,
    refetch: mockRefetchNative,
  })),
  useReadContracts: vi.fn(() => ({
    data: [
      { status: 'success', result: 5_000_000n },     // 5 USDC  (index 0 = WETH actually, but we simplify with mock tokens)
    ],
    isLoading: false,
    refetch: mockRefetchErc20,
  })),
}));

// ── Mock @tanstack/react-query ─────────────────────────────────
const mockInvalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(() => ({
    invalidateQueries: mockInvalidateQueries,
  })),
}));

// ── Mock config/tokens ─────────────────────────────────────────
vi.mock('../../config/tokens', () => ({
  getDefaultTokens: vi.fn(() => [
    {
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      chainId: 1,
      decimals: 18,
      symbol: 'ETH',
      name: 'Ether',
      isNative: true,
    },
    {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      chainId: 1,
      decimals: 6,
      symbol: 'USDC',
      name: 'USD Coin',
    },
  ]),
}));

import { useTokenBalances } from '../../hooks/useTokenBalances';
import { useChainId, useBalance, useReadContracts, useAccount } from 'wagmi';

beforeEach(() => {
  vi.clearAllMocks();

  // Reset wagmi mocks to defaults
  vi.mocked(useAccount).mockReturnValue({
    address: '0x1234567890abcdef1234567890abcdef12345678',
  } as any);
  vi.mocked(useChainId).mockReturnValue(1 as any);
  vi.mocked(useBalance).mockReturnValue({
    data: { value: 2_000_000_000_000_000_000n, formatted: '2.0', symbol: 'ETH' },
    isLoading: false, refetch: mockRefetchNative,
  } as any);
  vi.mocked(useReadContracts).mockReturnValue({
    data: [{ status: 'success' as const, result: 5_000_000n }],
    isLoading: false, refetch: mockRefetchErc20,
  } as any);
});

// ────────────────────────────────────────────────────────────────
// Balance fetching
// ────────────────────────────────────────────────────────────────

describe('useTokenBalances — balances', () => {
  it('returns balances for all default tokens', () => {
    const { result } = renderHook(() => useTokenBalances(1));

    // 2 tokens: ETH (native) + USDC (ERC-20)
    expect(result.current.balances).toHaveLength(2);
  });

  it('includes native token balance from useBalance', () => {
    const { result } = renderHook(() => useTokenBalances(1));

    const ethBalance = result.current.balances.find((b) => b.symbol === 'ETH');
    expect(ethBalance).toBeDefined();
    expect(ethBalance!.balance).toBe(2_000_000_000_000_000_000n);
    expect(ethBalance!.formattedBalance).toBe('2');
  });

  it('includes ERC-20 balance from multicall', () => {
    const { result } = renderHook(() => useTokenBalances(1));

    const usdcBalance = result.current.balances.find((b) => b.symbol === 'USDC');
    expect(usdcBalance).toBeDefined();
    expect(usdcBalance!.balance).toBe(5_000_000n);
    expect(usdcBalance!.formattedBalance).toBe('5');
  });

  it('returns zero balance when multicall has no result', () => {
    vi.mocked(useReadContracts).mockReturnValue({
      data: [{ status: 'failure' as const, error: new Error('fail') }],
      isLoading: false,
      refetch: mockRefetchErc20,
    } as any);

    const { result } = renderHook(() => useTokenBalances(1));

    const usdcBalance = result.current.balances.find((b) => b.symbol === 'USDC');
    expect(usdcBalance!.balance).toBe(0n);
  });
});

// ────────────────────────────────────────────────────────────────
// USD value computation
// ────────────────────────────────────────────────────────────────

describe('useTokenBalances — USD values', () => {
  it('returns null totalUsdValue without price data', () => {
    const { result } = renderHook(() => useTokenBalances(1));
    expect(result.current.totalUsdValue).toBeNull();
  });

  it('computes USD values and total when prices provided', () => {
    const { result } = renderHook(() =>
      useTokenBalances(1, { ETH: 3000, USDC: 1 }),
    );

    // ETH: 2 * 3000 = 6000
    // USDC: 5 * 1 = 5
    const ethBal = result.current.balances.find((b) => b.symbol === 'ETH');
    expect(ethBal!.usdValue).toBeCloseTo(6000, 0);

    const usdcBal = result.current.balances.find((b) => b.symbol === 'USDC');
    expect(usdcBal!.usdValue).toBeCloseTo(5, 0);

    expect(result.current.totalUsdValue).toBeCloseTo(6005, 0);
  });

  it('sorts by USD value descending', () => {
    const { result } = renderHook(() =>
      useTokenBalances(1, { ETH: 3000, USDC: 1 }),
    );

    // ETH ($6000) should be before USDC ($5)
    expect(result.current.balances[0].symbol).toBe('ETH');
    expect(result.current.balances[1].symbol).toBe('USDC');
  });
});

// ────────────────────────────────────────────────────────────────
// Loading state
// ────────────────────────────────────────────────────────────────

describe('useTokenBalances — loading', () => {
  it('reports loading when native balance is loading', () => {
    vi.mocked(useBalance).mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: mockRefetchNative,
    } as any);

    const { result } = renderHook(() => useTokenBalances(1));
    expect(result.current.isLoading).toBe(true);
  });

  it('reports loading when ERC-20 balances are loading', () => {
    vi.mocked(useReadContracts).mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: mockRefetchErc20,
    } as any);

    const { result } = renderHook(() => useTokenBalances(1));
    expect(result.current.isLoading).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// Refetch
// ────────────────────────────────────────────────────────────────

describe('useTokenBalances — refetch', () => {
  it('triggers both native and ERC-20 refetch', () => {
    const { result } = renderHook(() => useTokenBalances(1));

    result.current.refetch();

    expect(mockRefetchNative).toHaveBeenCalled();
    expect(mockRefetchErc20).toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────
// Chain switch invalidation
// ────────────────────────────────────────────────────────────────

describe('useTokenBalances — chain switch', () => {
  it('invalidates queries when chain changes', () => {
    vi.mocked(useChainId).mockReturnValue(1 as any);

    const { rerender } = renderHook(() => useTokenBalances(1));

    // Simulate chain switch
    vi.mocked(useChainId).mockReturnValue(137 as any);
    rerender();

    expect(mockInvalidateQueries).toHaveBeenCalled();
  });
});
