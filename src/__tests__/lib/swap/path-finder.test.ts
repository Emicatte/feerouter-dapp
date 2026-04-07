/**
 * src/__tests__/lib/swap/path-finder.test.ts — Optimal route selection
 *
 * Tests route discovery with mock quoter, sorting by output,
 * gas-tie-breaking, 2-hop routes, and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Token } from '../../../types/token';
import type { SupportedChainId } from '../../../types/chain';

// ── Mock quoter module ─────────────────────────────────────────
vi.mock('../../../lib/swap/quoter', () => ({
  quoteSingleHop: vi.fn(),
  quoteMultiHop: vi.fn(),
  buildQuoteFromRoute: vi.fn(),
}));

import { findOptimalPath, findBestRoute } from '../../../lib/swap/path-finder';
import { quoteSingleHop, quoteMultiHop, buildQuoteFromRoute } from '../../../lib/swap/quoter';

const CHAIN_ID: SupportedChainId = 1;

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

const mockClient = {} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────
// findOptimalPath
// ────────────────────────────────────────────────────────────────

describe('findOptimalPath', () => {
  it('returns empty array without client', async () => {
    const result = await findOptimalPath(ETH, USDC, 1000n, CHAIN_ID, undefined);
    expect(result).toEqual([]);
  });

  it('returns empty array for zero amount', async () => {
    const result = await findOptimalPath(ETH, USDC, 0n, CHAIN_ID, mockClient);
    expect(result).toEqual([]);
  });

  it('returns candidates sorted by output descending', async () => {
    vi.mocked(quoteSingleHop)
      .mockResolvedValueOnce({ amountOut: 1000n, sqrtPriceX96After: 0n, initializedTicksCrossed: 0, gasEstimate: 150000n })
      .mockResolvedValueOnce({ amountOut: 3000n, sqrtPriceX96After: 0n, initializedTicksCrossed: 0, gasEstimate: 150000n })
      .mockResolvedValueOnce({ amountOut: 2000n, sqrtPriceX96After: 0n, initializedTicksCrossed: 0, gasEstimate: 150000n })
      .mockResolvedValueOnce({ amountOut: 500n, sqrtPriceX96After: 0n, initializedTicksCrossed: 0, gasEstimate: 150000n });

    vi.mocked(quoteMultiHop).mockResolvedValue(null);

    const result = await findOptimalPath(ETH, USDC, 1_000_000n, CHAIN_ID, mockClient);

    expect(result.length).toBeGreaterThan(0);
    // Sorted by output descending
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].estimatedOutput).toBeGreaterThanOrEqual(result[i].estimatedOutput);
    }
    expect(result[0].estimatedOutput).toBe(3000n);
  });

  it('includes 2-hop routes', async () => {
    vi.mocked(quoteSingleHop).mockResolvedValue(null);

    vi.mocked(quoteMultiHop).mockResolvedValue({
      amountOut: 5000n,
      sqrtPriceX96AfterList: [0n, 0n],
      initializedTicksCrossedList: [0, 0],
      gasEstimate: 300000n,
    });

    const result = await findOptimalPath(ETH, USDC, 1_000_000n, CHAIN_ID, mockClient);
    const multiHop = result.filter((c) => c.route.path.length === 3);
    expect(multiHop.length).toBeGreaterThan(0);
  });

  it('prefers lower gas on output tie', async () => {
    vi.mocked(quoteSingleHop)
      .mockResolvedValueOnce({ amountOut: 1000n, sqrtPriceX96After: 0n, initializedTicksCrossed: 0, gasEstimate: 200000n })
      .mockResolvedValueOnce({ amountOut: 1000n, sqrtPriceX96After: 0n, initializedTicksCrossed: 0, gasEstimate: 100000n })
      .mockResolvedValue(null);

    vi.mocked(quoteMultiHop).mockResolvedValue(null);

    const result = await findOptimalPath(ETH, USDC, 1_000_000n, CHAIN_ID, mockClient);
    const tied = result.filter((c) => c.estimatedOutput === 1000n);
    if (tied.length >= 2) {
      expect(tied[0].gasEstimate).toBeLessThanOrEqual(tied[1].gasEstimate);
    }
  });

  it('returns empty when all quotes fail', async () => {
    vi.mocked(quoteSingleHop).mockResolvedValue(null);
    vi.mocked(quoteMultiHop).mockResolvedValue(null);

    const result = await findOptimalPath(ETH, USDC, 1_000_000n, CHAIN_ID, mockClient);
    expect(result).toEqual([]);
  });

  it('handles quoter rejection gracefully', async () => {
    vi.mocked(quoteSingleHop).mockRejectedValue(new Error('RPC timeout'));
    vi.mocked(quoteMultiHop).mockRejectedValue(new Error('RPC timeout'));

    const result = await findOptimalPath(ETH, USDC, 1_000_000n, CHAIN_ID, mockClient);
    expect(result).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────
// findBestRoute
// ────────────────────────────────────────────────────────────────

describe('findBestRoute', () => {
  it('returns null when no routes found', async () => {
    vi.mocked(quoteSingleHop).mockResolvedValue(null);
    vi.mocked(quoteMultiHop).mockResolvedValue(null);

    const result = await findBestRoute(mockClient, ETH, USDC, 1_000_000n, CHAIN_ID);
    expect(result).toBeNull();
    expect(buildQuoteFromRoute).not.toHaveBeenCalled();
  });

  it('builds quote from best candidate', async () => {
    vi.mocked(quoteSingleHop)
      .mockResolvedValueOnce({ amountOut: 5000n, sqrtPriceX96After: 0n, initializedTicksCrossed: 0, gasEstimate: 150000n })
      .mockResolvedValue(null);
    vi.mocked(quoteMultiHop).mockResolvedValue(null);

    const mockQuote = {
      inputToken: ETH,
      outputToken: USDC,
      inputAmount: 1_000_000n,
      outputAmount: 5000n,
      executionPrice: '0.005',
      priceImpact: 0.1,
      route: { path: [ETH, USDC], pools: [], type: 'EXACT_INPUT' as const },
      gasEstimate: 150000n,
      fee: { amount: 0n, percentage: 0 },
      slippageTolerance: 0.5,
      deadline: 20,
      minimumReceived: 4975n,
    };
    vi.mocked(buildQuoteFromRoute).mockReturnValue(mockQuote);

    const result = await findBestRoute(mockClient, ETH, USDC, 1_000_000n, CHAIN_ID);
    expect(result).not.toBeNull();
    expect(buildQuoteFromRoute).toHaveBeenCalledOnce();
  });

  it('passes slippage and deadline to builder', async () => {
    vi.mocked(quoteSingleHop)
      .mockResolvedValueOnce({ amountOut: 1000n, sqrtPriceX96After: 0n, initializedTicksCrossed: 0, gasEstimate: 100000n })
      .mockResolvedValue(null);
    vi.mocked(quoteMultiHop).mockResolvedValue(null);
    vi.mocked(buildQuoteFromRoute).mockReturnValue({} as any);

    await findBestRoute(mockClient, ETH, USDC, 1_000_000n, CHAIN_ID, 1.0, 30);

    expect(buildQuoteFromRoute).toHaveBeenCalledWith(
      ETH, USDC, 1_000_000n, 1000n, 100000n,
      expect.any(Object), 1.0, 30,
    );
  });
});
