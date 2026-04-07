/**
 * src/__tests__/hooks/useWalletConnection.test.ts — Wallet connection hook
 *
 * Tests connect, disconnect, chain switch, ENS resolution,
 * native balance, event callbacks, and store synchronization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mock functions ─────────────────────────────────────────────
const mockWagmiConnect = vi.fn();
const mockWagmiDisconnect = vi.fn();
const mockWagmiSwitchChain = vi.fn();
const mockSetWallet = vi.fn();
const mockResetWallet = vi.fn();
const mockSetLastConnector = vi.fn();

// ── Mock wagmi ─────────────────────────────────────────────────
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    address: undefined,
    chainId: 1,
    isConnected: false,
    isConnecting: false,
    connector: undefined,
  })),
  useConnect: vi.fn(() => ({
    connect: mockWagmiConnect,
    connectors: [
      { id: 'injected', name: 'MetaMask' },
      { id: 'walletConnect', name: 'WalletConnect' },
    ],
    error: null,
  })),
  useDisconnect: vi.fn(() => ({ disconnect: mockWagmiDisconnect })),
  useSwitchChain: vi.fn(() => ({ switchChain: mockWagmiSwitchChain })),
  useEnsName: vi.fn(() => ({ data: null })),
  useEnsAvatar: vi.fn(() => ({ data: null })),
  useBalance: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    refetch: vi.fn(),
  })),
}));

// ── Mock store ─────────────────────────────────────────────────
vi.mock('../../store', () => ({
  useAppStore: vi.fn((selector: Function) => {
    const state = {
      setWallet: mockSetWallet,
      resetWallet: mockResetWallet,
      setLastConnector: mockSetLastConnector,
    };
    return selector(state);
  }),
}));

import { useAccount, useConnect, useDisconnect, useSwitchChain, useEnsName, useEnsAvatar, useBalance } from 'wagmi';
import { useWalletConnection } from '../../hooks/useWalletConnection';

beforeEach(() => {
  vi.clearAllMocks();

  // Reset wagmi mocks to defaults (vi.clearAllMocks only clears call history)
  vi.mocked(useAccount).mockReturnValue({
    address: undefined, chainId: 1, isConnected: false,
    isConnecting: false, connector: undefined,
  } as any);
  vi.mocked(useConnect).mockReturnValue({
    connect: mockWagmiConnect,
    connectors: [
      { id: 'injected', name: 'MetaMask' },
      { id: 'walletConnect', name: 'WalletConnect' },
    ],
    error: null,
  } as any);
  vi.mocked(useDisconnect).mockReturnValue({ disconnect: mockWagmiDisconnect } as any);
  vi.mocked(useSwitchChain).mockReturnValue({ switchChain: mockWagmiSwitchChain } as any);
  vi.mocked(useEnsName).mockReturnValue({ data: null } as any);
  vi.mocked(useEnsAvatar).mockReturnValue({ data: null } as any);
  vi.mocked(useBalance).mockReturnValue({
    data: undefined, isLoading: false, refetch: vi.fn(),
  } as any);
});

// ────────────────────────────────────────────────────────────────
// Connection states
// ────────────────────────────────────────────────────────────────

describe('useWalletConnection — connection states', () => {
  it('returns disconnected status by default', () => {
    const { result } = renderHook(() => useWalletConnection());
    expect(result.current.connectionStatus).toBe('disconnected');
    expect(result.current.wallet.isConnected).toBe(false);
    expect(result.current.wallet.address).toBeNull();
  });

  it('returns connecting status during connection attempt', () => {
    vi.mocked(useAccount).mockReturnValue({
      address: undefined,
      chainId: undefined,
      isConnected: false,
      isConnecting: true,
      connector: undefined,
    } as any);

    const { result } = renderHook(() => useWalletConnection());
    expect(result.current.connectionStatus).toBe('connecting');
  });

  it('returns connected status with address', () => {
    vi.mocked(useAccount).mockReturnValue({
      address: '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`,
      chainId: 1,
      isConnected: true,
      isConnecting: false,
      connector: { id: 'injected', name: 'MetaMask' },
    } as any);

    const { result } = renderHook(() => useWalletConnection());
    expect(result.current.connectionStatus).toBe('connected');
    expect(result.current.wallet.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(result.current.wallet.connector).toBe('MetaMask');
  });

  it('returns error status when connect fails', () => {
    vi.mocked(useConnect).mockReturnValue({
      connect: mockWagmiConnect,
      connectors: [],
      error: new Error('User rejected'),
    } as any);

    const { result } = renderHook(() => useWalletConnection());
    expect(result.current.connectionStatus).toBe('error');
    expect(result.current.error?.message).toBe('User rejected');
  });
});

// ────────────────────────────────────────────────────────────────
// Actions
// ────────────────────────────────────────────────────────────────

describe('useWalletConnection — actions', () => {
  it('returns available connectors', () => {
    const { result } = renderHook(() => useWalletConnection());
    expect(result.current.connectors).toHaveLength(2);
    expect(result.current.connectors[0]).toEqual({ id: 'injected', name: 'MetaMask' });
  });

  it('calls wagmi connect with specified connector', () => {
    const { result } = renderHook(() => useWalletConnection());
    act(() => {
      result.current.connect('injected');
    });
    expect(mockWagmiConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        connector: expect.objectContaining({ id: 'injected' }),
      }),
    );
  });

  it('calls wagmi connect with first connector when no ID', () => {
    const { result } = renderHook(() => useWalletConnection());
    act(() => {
      result.current.connect();
    });
    expect(mockWagmiConnect).toHaveBeenCalled();
  });

  it('calls wagmi disconnect', () => {
    const { result } = renderHook(() => useWalletConnection());
    act(() => {
      result.current.disconnect();
    });
    expect(mockWagmiDisconnect).toHaveBeenCalled();
  });

  it('calls wagmi switchChain with chain ID', () => {
    const { result } = renderHook(() => useWalletConnection());
    act(() => {
      result.current.switchChain(137);
    });
    expect(mockWagmiSwitchChain).toHaveBeenCalledWith({ chainId: 137 });
  });
});

// ────────────────────────────────────────────────────────────────
// Native balance
// ────────────────────────────────────────────────────────────────

describe('useWalletConnection — native balance', () => {
  it('returns native balance when connected', () => {
    vi.mocked(useAccount).mockReturnValue({
      address: '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`,
      chainId: 1,
      isConnected: true,
      isConnecting: false,
      connector: { id: 'injected', name: 'MetaMask' },
    } as any);

    vi.mocked(useBalance).mockReturnValue({
      data: { value: 1_000_000_000_000_000_000n, formatted: '1.0', symbol: 'ETH' },
      isLoading: false,
      refetch: vi.fn(),
    } as any);

    const { result } = renderHook(() => useWalletConnection());
    expect(result.current.nativeBalance).toBe(1_000_000_000_000_000_000n);
    expect(result.current.formattedNativeBalance).toBe('1.0');
    expect(result.current.nativeSymbol).toBe('ETH');
  });

  it('returns undefined balance when disconnected', () => {
    const { result } = renderHook(() => useWalletConnection());
    expect(result.current.nativeBalance).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
// Store synchronization
// ────────────────────────────────────────────────────────────────

describe('useWalletConnection — store sync', () => {
  it('syncs wallet state to store on connect', () => {
    vi.mocked(useAccount).mockReturnValue({
      address: '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`,
      chainId: 1,
      isConnected: true,
      isConnecting: false,
      connector: { id: 'injected', name: 'MetaMask' },
    } as any);

    renderHook(() => useWalletConnection());
    expect(mockSetWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0x1234567890abcdef1234567890abcdef12345678',
        isConnected: true,
        chainId: 1,
      }),
    );
  });

  it('resets store on disconnect', () => {
    vi.mocked(useAccount).mockReturnValue({
      address: undefined,
      chainId: undefined,
      isConnected: false,
      isConnecting: false,
      connector: undefined,
    } as any);

    renderHook(() => useWalletConnection());
    expect(mockResetWallet).toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────
// Event callbacks
// ────────────────────────────────────────────────────────────────

describe('useWalletConnection — callbacks', () => {
  it('fires onConnect when transitioning to connected', () => {
    const onConnect = vi.fn();

    // Start disconnected
    vi.mocked(useAccount).mockReturnValue({
      address: undefined,
      chainId: 1,
      isConnected: false,
      isConnecting: false,
      connector: undefined,
    } as any);

    const { rerender } = renderHook(() => useWalletConnection({ onConnect }));

    // Transition to connected
    vi.mocked(useAccount).mockReturnValue({
      address: '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`,
      chainId: 1,
      isConnected: true,
      isConnecting: false,
      connector: { id: 'injected', name: 'MetaMask' },
    } as any);

    rerender();

    expect(onConnect).toHaveBeenCalledWith(
      '0x1234567890abcdef1234567890abcdef12345678',
      1,
    );
  });

  it('fires onDisconnect when transitioning from connected', () => {
    const onDisconnect = vi.fn();

    // Start connected
    vi.mocked(useAccount).mockReturnValue({
      address: '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`,
      chainId: 1,
      isConnected: true,
      isConnecting: false,
      connector: { id: 'injected', name: 'MetaMask' },
    } as any);

    const { rerender } = renderHook(() => useWalletConnection({ onDisconnect }));

    // Transition to disconnected
    vi.mocked(useAccount).mockReturnValue({
      address: undefined,
      chainId: undefined,
      isConnected: false,
      isConnecting: false,
      connector: undefined,
    } as any);

    rerender();
    expect(onDisconnect).toHaveBeenCalled();
  });
});
