/**
 * src/__tests__/hooks/useSwap.test.ts — Swap execution hook
 *
 * Tests quote flow (debounce, no-route, error), execute with mock tx,
 * price impact blocking, reset, and quote staleness.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Token } from '../../types/token';
import type { SwapQuote } from '../../types/swap';

// ── Mock functions ─────────────────────────────────────────────
const mockSendTxAsync = vi.fn();
const mockWaitReceipt = vi.fn();
const mockSetAmountOut = vi.fn();
const mockSetQuote = vi.fn();
const mockSetIsQuoting = vi.fn();

// ── Mock wagmi ─────────────────────────────────────────────────
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    address: '0x1234567890abcdef1234567890abcdef12345678',
  })),
  useChainId: vi.fn(() => 1),
  usePublicClient: vi.fn(() => ({
    waitForTransactionReceipt: mockWaitReceipt,
  })),
  useSendTransaction: vi.fn(() => ({
    sendTransactionAsync: mockSendTxAsync,
  })),
}));

// ── Mock path-finder ───────────────────────────────────────────
vi.mock('../../lib/swap/path-finder', () => ({
  findBestRoute: vi.fn(),
}));

// ── Mock router ────────────────────────────────────────────────
vi.mock('../../lib/swap/router', () => ({
  encodeSwapTransaction: vi.fn(),
}));

// ── Mock store ─────────────────────────────────────────────────
vi.mock('../../store', () => ({
  useAppStore: vi.fn((selector: Function) => {
    const state = {
      slippage: 0.5,
      deadline: 20,
      setAmountOut: mockSetAmountOut,
      setQuote: mockSetQuote,
      setIsQuoting: mockSetIsQuoting,
    };
    return selector(state);
  }),
}));

import { useSwap } from '../../hooks/useSwap';
import { findBestRoute } from '../../lib/swap/path-finder';
import { encodeSwapTransaction } from '../../lib/swap/router';

const ETH: Token = {
  address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  chainId: 1,
  decimals: 18,
  symbol: 'ETH',
  name: 'Ether',
  isNative: true,
};

const USDC: Token = {
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  chainId: 1,
  decimals: 6,
  symbol: 'USDC',
  name: 'USD Coin',
};

const mockQuote: SwapQuote = {
  inputToken: ETH,
  outputToken: USDC,
  inputAmount: 1_000_000_000_000_000_000n,
  outputAmount: 3_000_000_000n,
  executionPrice: '3000',
  priceImpact: 0.1,
  route: { path: [ETH, USDC], pools: [], type: 'EXACT_INPUT' },
  gasEstimate: 150_000n,
  fee: { amount: 0n, percentage: 0 },
  slippageTolerance: 0.5,
  deadline: 20,
  minimumReceived: 2_985_000_000n,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ────────────────────────────────────────────────────────────────
// Initial state
// ────────────────────────────────────────────────────────────────

describe('useSwap — initial state', () => {
  it('starts in idle with no quote', () => {
    const { result } = renderHook(() => useSwap());
    expect(result.current.quote).toBeNull();
    expect(result.current.status).toBe('idle');
    expect(result.current.swapStatus).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.txHash).toBeNull();
    expect(result.current.isQuoteStale).toBe(false);
    expect(result.current.priceChangeWarning).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// Quote fetching
// ────────────────────────────────────────────────────────────────

describe('useSwap — fetchQuote', () => {
  it('fetches quote after debounce (300ms)', async () => {
    vi.mocked(findBestRoute).mockResolvedValue(mockQuote);

    const { result } = renderHook(() => useSwap());

    await act(async () => {
      const promise = result.current.fetchQuote(ETH, USDC, 1_000_000_000_000_000_000n);
      await vi.advanceTimersByTimeAsync(300);
      await promise;
    });

    expect(findBestRoute).toHaveBeenCalled();
    expect(result.current.swapStatus).toBe('quoted');
    expect(result.current.quote).not.toBeNull();
  });

  it('sets error when no route found', async () => {
    vi.mocked(findBestRoute).mockResolvedValue(null);

    const { result } = renderHook(() => useSwap());

    await act(async () => {
      const promise = result.current.fetchQuote(ETH, USDC, 1_000_000_000_000_000_000n);
      await vi.advanceTimersByTimeAsync(300);
      await promise;
    });

    expect(result.current.error).toBe('No route found for this pair');
    expect(result.current.swapStatus).toBe('idle');
  });

  it('clears quote for zero amount', async () => {
    const { result } = renderHook(() => useSwap());

    await act(async () => {
      await result.current.fetchQuote(ETH, USDC, 0n);
    });

    expect(result.current.quote).toBeNull();
    expect(mockSetAmountOut).toHaveBeenCalledWith('');
  });

  it('handles quote failure gracefully', async () => {
    vi.mocked(findBestRoute).mockRejectedValue(new Error('RPC timeout'));

    const { result } = renderHook(() => useSwap());

    await act(async () => {
      const promise = result.current.fetchQuote(ETH, USDC, 1_000_000_000_000_000_000n);
      await vi.advanceTimersByTimeAsync(300);
      await promise;
    });

    expect(result.current.error).toBe('RPC timeout');
    expect(result.current.swapStatus).toBe('failed');
  });

  it('debounces multiple rapid calls (only last executes)', async () => {
    vi.mocked(findBestRoute).mockResolvedValue(mockQuote);

    const { result } = renderHook(() => useSwap());

    await act(async () => {
      // Fire 3 rapid calls — only last should execute
      result.current.fetchQuote(ETH, USDC, 100n);
      result.current.fetchQuote(ETH, USDC, 200n);
      const promise = result.current.fetchQuote(ETH, USDC, 300n);
      await vi.advanceTimersByTimeAsync(300);
      await promise;
    });

    // findBestRoute called once (debounce cancelled previous calls)
    expect(findBestRoute).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────────────────────────────
// Swap execution
// ────────────────────────────────────────────────────────────────

describe('useSwap — executeSwap', () => {
  it('blocks execution when price impact > 15%', async () => {
    const blockedQuote = { ...mockQuote, priceImpact: 20 };
    vi.mocked(findBestRoute).mockResolvedValue(blockedQuote);

    const { result } = renderHook(() => useSwap());

    // Fetch a quote with high impact
    await act(async () => {
      const promise = result.current.fetchQuote(ETH, USDC, 1_000_000_000_000_000_000n);
      await vi.advanceTimersByTimeAsync(300);
      await promise;
    });

    // Try to execute
    await act(async () => {
      await result.current.executeSwap();
    });

    expect(result.current.error).toContain('Price impact too high');
    expect(mockSendTxAsync).not.toHaveBeenCalled();
  });

  it('sends transaction and waits for receipt', async () => {
    vi.mocked(findBestRoute).mockResolvedValue(mockQuote);
    const txHash = '0x' + 'a'.repeat(64);
    vi.mocked(encodeSwapTransaction).mockResolvedValue({
      to: '0xE592427A0AEce92De3Edee1F18E0157C05861564' as `0x${string}`,
      data: '0x414bf389' as `0x${string}`,
      value: 0n,
    });
    mockSendTxAsync.mockResolvedValue(txHash);
    mockWaitReceipt.mockResolvedValue({ status: 'success' });

    const { result } = renderHook(() => useSwap());

    // First fetch a valid quote
    await act(async () => {
      const promise = result.current.fetchQuote(ETH, USDC, 1_000_000_000_000_000_000n);
      await vi.advanceTimersByTimeAsync(300);
      await promise;
    });

    // Execute the swap
    await act(async () => {
      await result.current.executeSwap();
    });

    expect(mockSendTxAsync).toHaveBeenCalled();
    expect(result.current.status).toBe('confirmed');
    expect(result.current.swapStatus).toBe('confirmed');
  });

  it('handles user rejection', async () => {
    vi.mocked(findBestRoute).mockResolvedValue(mockQuote);
    vi.mocked(encodeSwapTransaction).mockResolvedValue({
      to: '0x1234' as `0x${string}`,
      data: '0x' as `0x${string}`,
      value: 0n,
    });
    mockSendTxAsync.mockRejectedValue(new Error('User rejected the request'));

    const { result } = renderHook(() => useSwap());

    await act(async () => {
      const promise = result.current.fetchQuote(ETH, USDC, 1_000_000_000_000_000_000n);
      await vi.advanceTimersByTimeAsync(300);
      await promise;
    });

    await act(async () => {
      await result.current.executeSwap();
    });

    expect(result.current.status).toBe('cancelled');
    expect(result.current.error).toContain('rejected');
  });
});

// ────────────────────────────────────────────────────────────────
// Reset
// ────────────────────────────────────────────────────────────────

describe('useSwap — reset', () => {
  it('resets all state to initial', () => {
    const { result } = renderHook(() => useSwap());

    act(() => {
      result.current.reset();
    });

    expect(result.current.quote).toBeNull();
    expect(result.current.status).toBe('idle');
    expect(result.current.swapStatus).toBe('idle');
    expect(result.current.txHash).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.priceChangeWarning).toBe(false);
    expect(mockSetQuote).toHaveBeenCalledWith(null);
  });
});
