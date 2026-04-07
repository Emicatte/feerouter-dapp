/**
 * src/components/wallet/ConnectButton.tsx — Wallet connect trigger
 *
 * Renders a connect button (with connector selection dropdown) when
 * disconnected, a loading state while connecting, and an account badge
 * when connected. Opens AccountModal on click when connected.
 */

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useWalletConnection } from '../../hooks/useWalletConnection';
import { truncateAddress } from '../../lib/utils/format';
import { useAppStore } from '../../store';
import { AccountModal } from './AccountModal';

/** ConnectButton props */
export interface ConnectButtonProps {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Inline SVG spinner for loading state.
 * @internal
 */
function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

/**
 * Wallet icon for mobile connected state.
 * @internal
 */
function WalletIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
      />
    </svg>
  );
}

/**
 * Map known connector IDs to a short display label for the icon placeholder.
 * @internal
 */
function getConnectorLabel(id: string): string {
  switch (id) {
    case 'injected':
    case 'metaMask':
      return 'MM';
    case 'walletConnect':
      return 'WC';
    case 'coinbaseWallet':
      return 'CB';
    default:
      return id.slice(0, 2).toUpperCase();
  }
}

/**
 * Wallet connect/disconnect button with connector selection.
 *
 * - **Disconnected**: shows "Connect Wallet" with hover animation.
 *   Clicking opens a dropdown of available connectors.
 * - **Connecting**: shows spinner + "Connecting...".
 * - **Connected**: shows ENS name or truncated address.
 *   Clicking opens the AccountModal. On mobile, shows only wallet icon.
 * - **No wallets**: shows a helpful message when no connectors are detected.
 */
export function ConnectButton({ className }: ConnectButtonProps) {
  const {
    wallet,
    connectionStatus,
    connect,
    disconnect,
    connectors,
    formattedNativeBalance,
    nativeSymbol,
  } = useWalletConnection();
  const activeModal = useAppStore((s) => s.activeModal);
  const openModal = useAppStore((s) => s.openModal);
  const closeModal = useAppStore((s) => s.closeModal);

  const [showConnectors, setShowConnectors] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /* ── Close dropdown on outside click ─────────────────────── */
  useEffect(() => {
    if (!showConnectors) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowConnectors(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showConnectors]);

  /* ── Close dropdown when connected ───────────────────────── */
  useEffect(() => {
    if (connectionStatus === 'connected') {
      setShowConnectors(false);
    }
  }, [connectionStatus]);

  /** Handle connector selection */
  const handleConnectorClick = useCallback(
    (connectorId: string) => {
      connect(connectorId);
    },
    [connect],
  );

  /* ── Connected state ─────────────────────────────────────── */
  if (wallet.isConnected && wallet.address) {
    return (
      <>
        <button
          type="button"
          onClick={() => openModal('account')}
          className={[
            'group relative flex items-center gap-2 rounded-xl',
            'bg-gray-800 px-4 py-2.5 text-sm font-medium text-white',
            'transition-all hover:bg-gray-700 hover:scale-[1.02] active:scale-[0.98]',
            className ?? '',
          ].join(' ')}
        >
          {wallet.ensAvatar && (
            <img
              src={wallet.ensAvatar}
              alt=""
              className="h-6 w-6 rounded-full"
            />
          )}
          {/* Desktop: show address or ENS */}
          <span className="hidden sm:inline">
            {wallet.ensName ?? truncateAddress(wallet.address)}
          </span>
          {/* Mobile: show only wallet icon */}
          <span className="sm:hidden">
            <WalletIcon />
          </span>
        </button>

        <AccountModal
          wallet={wallet}
          isOpen={activeModal === 'account'}
          onClose={closeModal}
          onDisconnect={disconnect}
          nativeBalance={formattedNativeBalance}
          nativeSymbol={nativeSymbol}
        />
      </>
    );
  }

  /* ── Connecting state ────────────────────────────────────── */
  if (wallet.isConnecting) {
    return (
      <button
        type="button"
        disabled
        className={[
          'flex items-center gap-2 rounded-xl',
          'bg-blue-600/70 px-6 py-2.5 text-sm font-medium text-white cursor-wait',
          className ?? '',
        ].join(' ')}
      >
        <Spinner />
        <span>Connecting...</span>
      </button>
    );
  }

  /* ── Disconnected state ──────────────────────────────────── */
  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setShowConnectors((prev) => !prev)}
        className={[
          'rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-medium text-white',
          'transition-all hover:bg-blue-500 hover:scale-[1.02]',
          'hover:shadow-lg hover:shadow-blue-500/25 active:scale-[0.98]',
          className ?? '',
        ].join(' ')}
      >
        Connect Wallet
      </button>

      {showConnectors && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-xl">
          <div className="p-2">
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Choose Wallet
            </p>
            {connectors.length > 0 ? (
              connectors.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleConnectorClick(c.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white transition-colors hover:bg-gray-800"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-800 text-xs font-bold text-gray-300">
                    {getConnectorLabel(c.id)}
                  </span>
                  <span>{c.name}</span>
                </button>
              ))
            ) : (
              <div className="px-4 py-6 text-center text-sm text-gray-400">
                No wallets detected. Install a Web3 wallet to continue.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

ConnectButton.displayName = 'ConnectButton';
