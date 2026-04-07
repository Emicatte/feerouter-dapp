/**
 * src/__tests__/components/swap/SwapCard.test.tsx — SwapCard component
 *
 * Tests rendering, input handling, token selection, flip button,
 * submit flow, and button state derivation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Token } from '../../../types/token';
import type { SwapQuote } from '../../../types/swap';

// ── Shared mock functions ──────────────────────────────────────
const mockFetchQuote = vi.fn();
const mockExecuteSwap = vi.fn();
const mockResetSwap = vi.fn();
const mockRefreshQuote = vi.fn();
const mockSetTokenIn = vi.fn();
const mockSetTokenOut = vi.fn();
const mockSetAmountIn = vi.fn();
const mockFlipTokens = vi.fn();
const mockOpenModal = vi.fn();
const mockCloseModal = vi.fn();
const mockApprove = vi.fn();

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

// ── Mock wagmi ─────────────────────────────────────────────────
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    address: '0x1234567890abcdef1234567890abcdef12345678',
    isConnected: true,
  })),
  useChainId: vi.fn(() => 1),
}));

// ── Mock viem ──────────────────────────────────────────────────
vi.mock('viem', () => ({
  parseUnits: vi.fn((val: string, dec: number) => {
    const parts = val.split('.');
    const whole = parts[0] || '0';
    const frac = (parts[1] || '').padEnd(dec, '0').slice(0, dec);
    return BigInt(whole + frac);
  }),
  formatUnits: vi.fn((val: bigint, dec: number) => {
    const s = val.toString().padStart(dec + 1, '0');
    return s.slice(0, s.length - dec) + '.' + s.slice(s.length - dec);
  }),
}));

// ── Mock useSwap ───────────────────────────────────────────────
vi.mock('../../../hooks/useSwap', () => ({
  useSwap: vi.fn(() => ({
    quote: null as SwapQuote | null,
    swapStatus: 'idle',
    txHash: null,
    error: null,
    isQuoteStale: false,
    priceChangeWarning: false,
    fetchQuote: mockFetchQuote,
    executeSwap: mockExecuteSwap,
    reset: mockResetSwap,
    refreshQuote: mockRefreshQuote,
  })),
}));

// ── Mock useTokenBalances ──────────────────────────────────────
vi.mock('../../../hooks/useTokenBalances', () => ({
  useTokenBalances: vi.fn(() => ({
    balances: [],
    isLoading: false,
    totalUsdValue: null,
    refetch: vi.fn(),
  })),
}));

// ── Mock useTokenApproval ──────────────────────────────────────
vi.mock('../../../hooks/useTokenApproval', () => ({
  useTokenApproval: vi.fn(() => ({
    needsApproval: false,
    approvalStatus: 'idle',
    approve: mockApprove,
  })),
}));

// ── Mock useGasEstimate ────────────────────────────────────────
vi.mock('../../../hooks/useGasEstimate', () => ({
  useGasEstimate: vi.fn(() => ({
    estimate: null,
    isLoading: false,
  })),
}));

// ── Mock slippage ──────────────────────────────────────────────
vi.mock('../../../lib/swap/slippage', () => ({
  isPriceImpactBlocked: vi.fn(() => false),
}));

// ── Mock constants ─────────────────────────────────────────────
vi.mock('../../../constants/addresses', () => ({
  CONTRACT_ADDRESSES: {
    1: { uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564' },
  },
}));

// ── Mock store ─────────────────────────────────────────────────
vi.mock('../../../store', () => ({
  useAppStore: vi.fn((selector: Function) => {
    const state = {
      tokenIn: null as Token | null,
      tokenOut: null as Token | null,
      amountIn: '',
      amountOut: '',
      isQuoting: false,
      activeModal: null,
      setTokenIn: mockSetTokenIn,
      setTokenOut: mockSetTokenOut,
      setAmountIn: mockSetAmountIn,
      flipTokens: mockFlipTokens,
      openModal: mockOpenModal,
      closeModal: mockCloseModal,
    };
    return selector(state);
  }),
}));

// ── Mock child components ──────────────────────────────────────
vi.mock('../../../components/swap/TokenInput', () => ({
  TokenInput: ({ label, onTokenSelect, onAmountChange, amount }: any) => (
    <div data-testid={`token-input-${label}`}>
      <input
        data-testid={`amount-input-${label}`}
        value={amount || ''}
        onChange={(e: any) => onAmountChange?.(e.target.value)}
      />
      <button
        data-testid={`select-token-${label}`}
        onClick={onTokenSelect}
      >
        Select
      </button>
    </div>
  ),
}));

vi.mock('../../../components/swap/TokenSelector', () => ({
  TokenSelector: () => null,
}));

vi.mock('../../../components/swap/SwapRoute', () => ({
  SwapRoute: () => null,
}));

vi.mock('../../../components/swap/PriceImpact', () => ({
  PriceImpact: () => null,
}));

vi.mock('../../../components/swap/ConfirmSwapModal', () => ({
  ConfirmSwapModal: () => null,
}));

import { SwapCard } from '../../../components/swap/SwapCard';
import { useAppStore } from '../../../store';
import { useSwap } from '../../../hooks/useSwap';
import { useAccount } from 'wagmi';

beforeEach(() => {
  vi.clearAllMocks();

  // Reset wagmi mocks to defaults
  vi.mocked(useAccount).mockReturnValue({
    address: '0x1234567890abcdef1234567890abcdef12345678',
    isConnected: true,
  } as any);

  // Reset useSwap to defaults
  vi.mocked(useSwap).mockReturnValue({
    quote: null,
    swapStatus: 'idle',
    status: 'idle',
    txHash: null,
    error: null,
    isQuoteStale: false,
    priceChangeWarning: false,
    fetchQuote: mockFetchQuote,
    executeSwap: mockExecuteSwap,
    reset: mockResetSwap,
    refreshQuote: mockRefreshQuote,
  });

  // Reset store to defaults
  vi.mocked(useAppStore as any).mockImplementation((selector: Function) => {
    const state = {
      tokenIn: null as Token | null,
      tokenOut: null as Token | null,
      amountIn: '',
      amountOut: '',
      isQuoting: false,
      activeModal: null,
      setTokenIn: mockSetTokenIn,
      setTokenOut: mockSetTokenOut,
      setAmountIn: mockSetAmountIn,
      flipTokens: mockFlipTokens,
      openModal: mockOpenModal,
      closeModal: mockCloseModal,
    };
    return selector(state);
  });
});

// ────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────

describe('SwapCard — rendering', () => {
  it('renders the swap card', () => {
    const { container } = render(<SwapCard />);
    expect(container.querySelector('.swap-card')).toBeTruthy();
  });

  it('renders header with "Swap" title', () => {
    render(<SwapCard />);
    expect(screen.getByText('Swap')).toBeTruthy();
  });

  it('renders both token input sections', () => {
    render(<SwapCard />);
    expect(screen.getByTestId('token-input-You pay')).toBeTruthy();
    expect(screen.getByTestId('token-input-You receive')).toBeTruthy();
  });

  it('renders flip button', () => {
    render(<SwapCard />);
    expect(screen.getByLabelText('Flip tokens')).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────
// Button states
// ────────────────────────────────────────────────────────────────

describe('SwapCard — button states', () => {
  it('shows "Connect Wallet" when disconnected', () => {
    vi.mocked(useAccount).mockReturnValue({
      address: undefined,
      isConnected: false,
    } as any);

    render(<SwapCard />);
    expect(screen.getByText('Connect Wallet')).toBeTruthy();
  });

  it('shows "Select input token" when no tokenIn', () => {
    render(<SwapCard />);
    expect(screen.getByText('Select input token')).toBeTruthy();
  });

  it('shows "Enter an amount" when tokens selected but no amount', () => {
    vi.mocked(useAppStore as any).mockImplementation((selector: Function) => {
      const state = {
        tokenIn: ETH,
        tokenOut: USDC,
        amountIn: '',
        amountOut: '',
        isQuoting: false,
        activeModal: null,
        setTokenIn: mockSetTokenIn,
        setTokenOut: mockSetTokenOut,
        setAmountIn: mockSetAmountIn,
        flipTokens: mockFlipTokens,
        openModal: mockOpenModal,
        closeModal: mockCloseModal,
      };
      return selector(state);
    });

    render(<SwapCard />);
    expect(screen.getByText('Enter an amount')).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────
// User interactions
// ────────────────────────────────────────────────────────────────

describe('SwapCard — interactions', () => {
  it('calls flipTokens and resetSwap when flip button clicked', () => {
    render(<SwapCard />);

    fireEvent.click(screen.getByLabelText('Flip tokens'));

    expect(mockFlipTokens).toHaveBeenCalled();
    expect(mockResetSwap).toHaveBeenCalled();
  });

  it('opens token selector when input token button clicked', () => {
    render(<SwapCard />);

    fireEvent.click(screen.getByTestId('select-token-You pay'));

    expect(mockOpenModal).toHaveBeenCalledWith('token-selector-in');
  });

  it('opens token selector when output token button clicked', () => {
    render(<SwapCard />);

    fireEvent.click(screen.getByTestId('select-token-You receive'));

    expect(mockOpenModal).toHaveBeenCalledWith('token-selector-out');
  });
});

// ────────────────────────────────────────────────────────────────
// Integration-like: swap flow button enable/disable
// ────────────────────────────────────────────────────────────────

describe('SwapCard — swap flow', () => {
  it('shows "Swap" button when quote is available', () => {
    vi.mocked(useAppStore as any).mockImplementation((selector: Function) => {
      const state = {
        tokenIn: ETH,
        tokenOut: USDC,
        amountIn: '1.0',
        amountOut: '3000',
        isQuoting: false,
        activeModal: null,
        setTokenIn: mockSetTokenIn,
        setTokenOut: mockSetTokenOut,
        setAmountIn: mockSetAmountIn,
        flipTokens: mockFlipTokens,
        openModal: mockOpenModal,
        closeModal: mockCloseModal,
      };
      return selector(state);
    });

    vi.mocked(useSwap).mockReturnValue({
      quote: {
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
      },
      swapStatus: 'idle',
      status: 'idle',
      txHash: null,
      error: null,
      isQuoteStale: false,
      priceChangeWarning: false,
      fetchQuote: mockFetchQuote,
      executeSwap: mockExecuteSwap,
      reset: mockResetSwap,
      refreshQuote: mockRefreshQuote,
    });

    render(<SwapCard />);
    const swapBtn = screen.getByRole('button', { name: 'Swap' });
    expect(swapBtn).toBeTruthy();
  });

  it('shows "Fetching quote..." when quoting', () => {
    vi.mocked(useAppStore as any).mockImplementation((selector: Function) => {
      const state = {
        tokenIn: ETH,
        tokenOut: USDC,
        amountIn: '1.0',
        amountOut: '',
        isQuoting: true,
        activeModal: null,
        setTokenIn: mockSetTokenIn,
        setTokenOut: mockSetTokenOut,
        setAmountIn: mockSetAmountIn,
        flipTokens: mockFlipTokens,
        openModal: mockOpenModal,
        closeModal: mockCloseModal,
      };
      return selector(state);
    });

    render(<SwapCard />);
    expect(screen.getByText('Fetching quote...')).toBeTruthy();
  });
});
