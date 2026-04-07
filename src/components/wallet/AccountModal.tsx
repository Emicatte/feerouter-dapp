/**
 * src/components/wallet/AccountModal.tsx — Account details modal
 *
 * Shows connected address, ENS data, native balance, copy-to-clipboard,
 * block explorer link, disconnect button, and recent transactions.
 * Uses Framer Motion for enter/exit animations.
 */

'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WalletState } from '../../types/wallet';
import type { SerializedTransaction, TxType, TxStatus } from '../../types/transaction';
import { truncateAddress } from '../../lib/utils/format';
import { getChain } from '../../config/chains';

/** A tracked transaction for display in the modal */
export interface RecentTransaction {
  /** Transaction hash */
  hash: string;
  /** Human-readable description */
  description: string;
  /** Current status */
  status: 'pending' | 'confirmed' | 'failed';
}

/** AccountModal props */
export interface AccountModalProps {
  /** Wallet connection state */
  wallet: WalletState;
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Callback to disconnect the wallet */
  onDisconnect: () => void;
  /** Formatted native balance (e.g. "1.2345") */
  nativeBalance?: string;
  /** Native token symbol (e.g. "ETH") */
  nativeSymbol?: string;
  /** Recent transactions list (placeholder — populated by PROMPT 5) */
  recentTransactions?: RecentTransaction[];
  /** Full tracked transactions from TxWatcher (PROMPT 5) */
  trackedTransactions?: SerializedTransaction[];
  /** Callback to clear transaction history (PROMPT 5) */
  onClearHistory?: () => void;
}

/**
 * Inline SVG icon: clipboard copy.
 * @internal
 */
function CopyIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

/**
 * Inline SVG icon: checkmark (copy success).
 * @internal
 */
function CheckIcon() {
  return (
    <svg
      className="h-4 w-4 text-green-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

/**
 * Inline SVG icon: external link.
 * @internal
 */
function ExternalLinkIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}

/**
 * Inline SVG icon: close (X).
 * @internal
 */
function CloseIcon() {
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
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}

/**
 * Status indicator dot for transaction status.
 * @internal
 */
function StatusDot({ status }: { status: RecentTransaction['status'] }) {
  const colors: Record<RecentTransaction['status'], string> = {
    pending: 'bg-yellow-400',
    confirmed: 'bg-green-400',
    failed: 'bg-red-400',
  };
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colors[status]}`}
      aria-label={status}
    />
  );
}

// ── PROMPT 5: Enhanced transaction display helpers ─────────────

/** SVG spinner for pending transactions */
function SpinnerIcon() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-yellow-400"
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

/** SVG error icon for failed transactions */
function ErrorIcon() {
  return (
    <svg
      className="h-4 w-4 text-red-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

/** SVG success icon for confirmed transactions */
function SuccessIcon() {
  return (
    <svg
      className="h-4 w-4 text-green-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

/** Get status icon component for a transaction status */
function TxStatusIcon({ status }: { status: TxStatus }) {
  switch (status) {
    case 'pending':
    case 'confirming':
    case 'approving':
      return <SpinnerIcon />;
    case 'confirmed':
      return <SuccessIcon />;
    case 'failed':
    case 'cancelled':
      return <ErrorIcon />;
    default:
      return null;
  }
}

/** Human-readable label for transaction type */
const TX_TYPE_LABELS: Record<TxType, string> = {
  swap: 'Swap',
  approve: 'Approve',
  transfer: 'Transfer',
  wrap: 'Wrap',
  unwrap: 'Unwrap',
};

/** Human-readable label for transaction status */
const TX_STATUS_LABELS: Record<TxStatus, string> = {
  idle: '',
  approving: 'Approving...',
  pending: 'Pending...',
  confirming: 'Confirming...',
  confirmed: 'Confirmed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Format a timestamp to relative time string */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Build a description string from a tracked transaction */
function buildTxDescription(tx: SerializedTransaction): string {
  const typeLabel = TX_TYPE_LABELS[tx.type] ?? tx.type;
  const meta = tx.metadata;
  if (tx.type === 'swap' && meta.tokenIn && meta.tokenOut) {
    return `${typeLabel} ${meta.tokenIn} → ${meta.tokenOut}`;
  }
  if (tx.type === 'approve' && meta.tokenSymbol) {
    return `${typeLabel} ${meta.tokenSymbol}`;
  }
  if ((tx.type === 'wrap' || tx.type === 'unwrap') && meta.tokenSymbol) {
    return `${typeLabel} ${meta.tokenSymbol}`;
  }
  return typeLabel;
}

/**
 * Modal displaying wallet account details.
 *
 * Features:
 * - Full address with copy-to-clipboard
 * - Link to block explorer
 * - Native token balance for the current chain
 * - Recent transactions list (placeholder for PROMPT 5)
 * - Disconnect button
 * - Framer Motion enter/exit spring animations
 */
export function AccountModal({
  wallet,
  isOpen,
  onClose,
  onDisconnect,
  nativeBalance,
  nativeSymbol,
  recentTransactions = [],
  trackedTransactions,
  onClearHistory,
}: AccountModalProps) {
  const [copied, setCopied] = useState(false);

  const chain = wallet.chainId ? getChain(wallet.chainId) : undefined;
  const explorerUrl = chain?.blockExplorers?.[0]?.url;
  const symbol = nativeSymbol ?? chain?.nativeCurrency?.symbol ?? 'ETH';

  /** Copy the full address to the clipboard */
  const copyAddress = useCallback(async () => {
    if (!wallet.address) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard API unavailable */
    }
  }, [wallet.address]);

  /** Disconnect and close the modal */
  const handleDisconnect = useCallback(() => {
    onDisconnect();
    onClose();
  }, [onDisconnect, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Modal container */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Account details"
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Account</h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
                  aria-label="Close"
                >
                  <CloseIcon />
                </button>
              </div>

              {/* ENS avatar */}
              {wallet.ensAvatar && (
                <div className="mb-4 flex justify-center">
                  <img
                    src={wallet.ensAvatar}
                    alt=""
                    className="h-16 w-16 rounded-full border-2 border-gray-700"
                  />
                </div>
              )}

              {/* ENS name */}
              {wallet.ensName && (
                <p className="mb-2 text-center text-lg font-medium text-white">
                  {wallet.ensName}
                </p>
              )}

              {/* Address + copy + explorer */}
              <div className="mb-4 flex items-center justify-center gap-2">
                <code className="text-sm text-gray-300">
                  {wallet.address ? truncateAddress(wallet.address, 8) : ''}
                </code>

                <button
                  type="button"
                  onClick={copyAddress}
                  className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
                  title={copied ? 'Copied!' : 'Copy address'}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>

                {explorerUrl && wallet.address && (
                  <a
                    href={`${explorerUrl}/address/${wallet.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
                    title="View on explorer"
                  >
                    <ExternalLinkIcon />
                  </a>
                )}
              </div>

              {/* Native balance */}
              <div className="mb-6 rounded-xl bg-gray-800 p-4">
                <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-400">
                  {symbol} Balance
                </p>
                <p className="text-2xl font-semibold text-white">
                  {nativeBalance
                    ? `${Number(nativeBalance).toFixed(4)} ${symbol}`
                    : '\u2014'}
                </p>
              </div>

              {/* Recent transactions */}
              <div className="mb-6">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                    Recent Transactions
                  </p>
                  {trackedTransactions && trackedTransactions.length > 0 && onClearHistory && (
                    <button
                      type="button"
                      onClick={onClearHistory}
                      className="text-xs text-gray-500 transition-colors hover:text-gray-300"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                {/* Enhanced tracked transactions (PROMPT 5) */}
                {trackedTransactions && trackedTransactions.length > 0 ? (
                  <div className="max-h-64 space-y-2 overflow-y-auto">
                    {trackedTransactions.slice(0, 10).map((tx) => {
                      const isPending =
                        tx.status === 'pending' ||
                        tx.status === 'confirming' ||
                        tx.status === 'approving';
                      const isFailed =
                        tx.status === 'failed' || tx.status === 'cancelled';

                      return (
                        <div
                          key={tx.hash}
                          className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2.5 text-sm"
                        >
                          <div className="flex items-center gap-2.5">
                            <TxStatusIcon status={tx.status} />
                            <div className="flex flex-col">
                              <span className="text-gray-200">
                                {buildTxDescription(tx)}
                              </span>
                              <span className="text-xs text-gray-500">
                                {isPending
                                  ? TX_STATUS_LABELS[tx.status]
                                  : formatRelativeTime(tx.timestamp)}
                                {isFailed && tx.error && (
                                  <span className="ml-1 text-red-400">
                                    — {tx.error}
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>
                          {explorerUrl && (
                            <a
                              href={`${explorerUrl}/tx/${tx.hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
                              title="View on explorer"
                            >
                              <ExternalLinkIcon />
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : recentTransactions.length > 0 ? (
                  /* Legacy fallback */
                  <div className="space-y-2">
                    {recentTransactions.map((tx) => (
                      <div
                        key={tx.hash}
                        className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <StatusDot status={tx.status} />
                          <span className="text-gray-300">
                            {tx.description}
                          </span>
                        </div>
                        {explorerUrl && (
                          <a
                            href={`${explorerUrl}/tx/${tx.hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:text-blue-300"
                          >
                            View
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">
                    No recent transactions
                  </p>
                )}
              </div>

              {/* Disconnect */}
              <button
                type="button"
                onClick={handleDisconnect}
                className="w-full rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20"
              >
                Disconnect
              </button>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

AccountModal.displayName = 'AccountModal';
