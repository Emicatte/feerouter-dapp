/**
 * src/hooks/useWalletConnection.ts — Wallet connection hook
 *
 * Wraps wagmi's useAccount/useConnect/useDisconnect into a unified
 * WalletState object with ENS resolution, chain switching, native
 * balance, event callbacks, and Zustand store synchronization.
 */

'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  useAccount,
  useConnect,
  useDisconnect,
  useEnsName,
  useEnsAvatar,
  useSwitchChain,
  useBalance,
} from 'wagmi';
import type { WalletState, ConnectorId } from '../types/wallet';
import { useAppStore } from '../store';

/** localStorage key for last-used connector */
const LAST_CONNECTOR_KEY = 'wc-last-connector';

/** Connection lifecycle status */
export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

/** Optional callbacks for wallet lifecycle events */
export interface WalletConnectionCallbacks {
  /** Fires when a wallet connects successfully */
  onConnect?: (address: `0x${string}`, chainId: number) => void;
  /** Fires when the wallet disconnects */
  onDisconnect?: () => void;
  /** Fires when the connected chain changes */
  onChainChanged?: (chainId: number) => void;
  /** Fires when the connected account changes */
  onAccountChanged?: (address: `0x${string}`) => void;
}

/** Return type of the wallet connection hook */
export interface UseWalletConnectionReturn {
  /** Current wallet state */
  wallet: WalletState;
  /** Connection lifecycle status */
  connectionStatus: ConnectionStatus;
  /** Connection error, if any */
  error: Error | null;
  /** Native token balance (raw bigint) */
  nativeBalance: bigint | undefined;
  /** Native token balance (formatted string, e.g. "1.2345") */
  formattedNativeBalance: string | undefined;
  /** Native token symbol (e.g. "ETH") */
  nativeSymbol: string | undefined;
  /** Connect to a wallet by connector ID */
  connect: (connectorId?: string) => void;
  /** Disconnect the current wallet */
  disconnect: () => void;
  /** Switch to a different chain */
  switchChain: (chainId: number) => void;
  /** List of available connectors */
  connectors: readonly { id: string; name: string }[];
}

/**
 * Unified wallet connection hook.
 *
 * Provides connection state, ENS data, native balance, chain switching,
 * and connect/disconnect actions. Automatically syncs state to the
 * Zustand wallet store and persists the last-used connector in
 * localStorage for auto-reconnect.
 *
 * @param callbacks - Optional event callbacks for wallet lifecycle events
 */
export function useWalletConnection(
  callbacks?: WalletConnectionCallbacks,
): UseWalletConnectionReturn {
  const { address, chainId, isConnected, isConnecting, connector } =
    useAccount();
  const {
    connect: wagmiConnect,
    connectors,
    error: connectError,
  } = useConnect();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { switchChain: wagmiSwitchChain } = useSwitchChain();

  /* ── ENS resolution ──────────────────────────────────────── */
  const { data: ensName } = useEnsName({
    address,
    query: { enabled: !!address },
  });
  const { data: ensAvatar } = useEnsAvatar({
    name: ensName ?? undefined,
    query: { enabled: !!ensName },
  });

  /* ── Native balance ──────────────────────────────────────── */
  const { data: balanceData } = useBalance({
    address,
    query: { enabled: !!address },
  });

  /* ── Zustand store actions ───────────────────────────────── */
  const setWallet = useAppStore((s) => s.setWallet);
  const resetWallet = useAppStore((s) => s.resetWallet);
  const setLastConnector = useAppStore((s) => s.setLastConnector);

  /* ── Track previous values for event callbacks ───────────── */
  const prevAddress = useRef(address);
  const prevChainId = useRef(chainId);
  const prevConnected = useRef(isConnected);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  /* ── Build wallet state ──────────────────────────────────── */
  const wallet: WalletState = {
    address: address ?? null,
    chainId: chainId ?? null,
    isConnected,
    isConnecting,
    connector: connector?.name ?? null,
    ensName: ensName ?? null,
    ensAvatar: ensAvatar ?? null,
  };

  /* ── Connection status derivation ────────────────────────── */
  const connectionStatus: ConnectionStatus = connectError
    ? 'error'
    : isConnecting
      ? 'connecting'
      : isConnected
        ? 'connected'
        : 'disconnected';

  /* ── Sync wallet state → Zustand store ───────────────────── */
  useEffect(() => {
    if (isConnected && address) {
      setWallet({
        address,
        chainId: chainId ?? null,
        isConnected: true,
        isConnecting: false,
        connector: connector?.name ?? null,
        ensName: ensName ?? null,
        ensAvatar: ensAvatar ?? null,
      });
    } else if (!isConnected) {
      resetWallet();
    }
  }, [
    isConnected,
    address,
    chainId,
    connector?.name,
    ensName,
    ensAvatar,
    setWallet,
    resetWallet,
  ]);

  /* ── Persist last connector to localStorage ──────────────── */
  useEffect(() => {
    if (connector?.id) {
      try {
        localStorage.setItem(LAST_CONNECTOR_KEY, connector.id);
      } catch {
        /* SSR or storage blocked */
      }
      setLastConnector(connector.id);
    }
  }, [connector?.id, setLastConnector]);

  /* ── Fire event callbacks on state transitions ───────────── */
  useEffect(() => {
    const cbs = callbacksRef.current;

    // onConnect
    if (isConnected && !prevConnected.current && address && chainId) {
      cbs?.onConnect?.(address, chainId);
    }

    // onDisconnect
    if (!isConnected && prevConnected.current) {
      cbs?.onDisconnect?.();
    }

    // onChainChanged
    if (
      chainId &&
      prevChainId.current !== undefined &&
      chainId !== prevChainId.current
    ) {
      cbs?.onChainChanged?.(chainId);
    }

    // onAccountChanged
    if (
      address &&
      prevAddress.current !== undefined &&
      address !== prevAddress.current
    ) {
      cbs?.onAccountChanged?.(address);
    }

    prevAddress.current = address;
    prevChainId.current = chainId;
    prevConnected.current = isConnected;
  }, [address, chainId, isConnected]);

  /* ── Actions ─────────────────────────────────────────────── */

  /**
   * Connect to a wallet.
   * @param connectorId - Connector ID to use. Falls back to the first available.
   */
  const connect = useCallback(
    (connectorId?: string) => {
      const target = connectorId
        ? connectors.find((c) => c.id === connectorId)
        : connectors[0];
      if (target) {
        wagmiConnect({ connector: target });
      }
    },
    [connectors, wagmiConnect],
  );

  /** Disconnect the wallet and clear persisted connector. */
  const disconnect = useCallback(() => {
    wagmiDisconnect();
    try {
      localStorage.removeItem(LAST_CONNECTOR_KEY);
    } catch {
      /* SSR or storage blocked */
    }
  }, [wagmiDisconnect]);

  /** Switch to a different chain by chain ID. */
  const switchChain = useCallback(
    (targetChainId: number) => {
      wagmiSwitchChain({ chainId: targetChainId });
    },
    [wagmiSwitchChain],
  );

  return {
    wallet,
    connectionStatus,
    error: connectError ?? null,
    nativeBalance: balanceData?.value,
    formattedNativeBalance: balanceData?.formatted,
    nativeSymbol: balanceData?.symbol,
    connect,
    disconnect,
    switchChain,
    connectors: connectors.map((c) => ({ id: c.id, name: c.name })),
  };
}
