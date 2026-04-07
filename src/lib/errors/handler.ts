/**
 * src/lib/errors/handler.ts — Global error handler
 *
 * Classifies raw errors from viem, wallet providers, and RPCs
 * into typed AppError instances. Logs for analytics (no sensitive data)
 * and notifies the UI via the toast store.
 *
 * @module errors/handler
 */

import {
  AppError,
  ErrorCode,
  WalletError,
  ConnectionError,
  ChainError,
  SignatureError,
  SwapError,
  QuoteError,
  SlippageError,
  InsufficientBalanceError,
  ApprovalError,
  RPCError,
  TimeoutError,
  RateLimitError,
  NetworkError,
  isAppError,
  isUserCancellation,
} from './index';
import { getErrorMessage } from './messages';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

/** Context passed to the error handler for better classification */
export interface ErrorContext {
  /** Operation that triggered the error */
  operation?: 'connect' | 'disconnect' | 'switch-chain' | 'sign' | 'approve' | 'swap' | 'quote' | 'balance' | 'rpc';
  /** Chain ID where the error occurred */
  chainId?: number;
  /** Whether to suppress toast notification */
  silent?: boolean;
}

/** Callback for showing errors in the UI */
export type ErrorNotifier = (notification: {
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  suggestion: string;
}) => void;

/** Error log entry (for analytics, no sensitive data) */
export interface ErrorLogEntry {
  code: ErrorCode;
  operation?: string;
  chainId?: number;
  recoverable: boolean;
  timestamp: number;
}

// ────────────────────────────────────────────────────────────────
// Error log buffer
// ────────────────────────────────────────────────────────────────

const errorLog: ErrorLogEntry[] = [];
const MAX_LOG_SIZE = 200;

/**
 * Get the error log entries (copy).
 * For analytics export — no sensitive data is stored.
 */
export function getErrorLog(): ErrorLogEntry[] {
  return [...errorLog];
}

/** Clear the error log buffer */
export function clearErrorLog(): void {
  errorLog.length = 0;
}

// ────────────────────────────────────────────────────────────────
// UI notifier (set once by the app root)
// ────────────────────────────────────────────────────────────────

let notifier: ErrorNotifier | null = null;

/**
 * Register the UI notification callback.
 * Call this once from the app root (e.g. in a useEffect).
 *
 * @param fn - Callback that shows error toast/notification
 */
export function setErrorNotifier(fn: ErrorNotifier): void {
  notifier = fn;
}

// ────────────────────────────────────────────────────────────────
// Classification: raw error → AppError
// ────────────────────────────────────────────────────────────────

/** Known viem/ethers error patterns for classification */
const ERROR_PATTERNS: Array<{
  test: (msg: string, name: string) => boolean;
  factory: (raw: Error) => AppError;
}> = [
  // ── User cancellation (not a real error) ─────────────────
  {
    test: (msg) =>
      msg.includes('user rejected') ||
      msg.includes('user denied') ||
      msg.includes('user cancelled') ||
      msg.includes('rejected the request') ||
      msg.includes('action_rejected'),
    factory: (raw) =>
      new WalletError(
        ErrorCode.WALLET_USER_REJECTED,
        raw.message,
        'Transaction was cancelled.',
        false,
        raw,
      ),
  },

  // ── Wallet not found / not installed ─────────────────────
  {
    test: (msg, name) =>
      msg.includes('no provider') ||
      msg.includes('wallet not found') ||
      msg.includes('not installed') ||
      name === 'ConnectorNotFoundError',
    factory: (raw) =>
      new WalletError(
        ErrorCode.WALLET_NOT_FOUND,
        raw.message,
        'No wallet detected. Please install a wallet extension.',
        true,
        raw,
      ),
  },

  // ── Chain errors ─────────────────────────────────────────
  {
    test: (msg) =>
      msg.includes('unsupported chain') ||
      msg.includes('chain mismatch') ||
      msg.includes('chainid'),
    factory: (raw) =>
      new ChainError(ErrorCode.CHAIN_UNSUPPORTED, raw.message, undefined, raw),
  },
  {
    test: (msg) =>
      msg.includes('switch chain') ||
      msg.includes('switchchain') ||
      msg.includes('wallet_switchethereumchain'),
    factory: (raw) =>
      new ChainError(ErrorCode.CHAIN_SWITCH_FAILED, raw.message, undefined, raw),
  },

  // ── Slippage / revert ────────────────────────────────────
  {
    test: (msg) =>
      msg.includes('too little received') ||
      msg.includes('too much requested') ||
      msg.includes('slippage') ||
      msg.includes('stf') ||
      msg.includes('price has changed'),
    factory: (raw) =>
      new SlippageError(raw.message, raw),
  },

  // ── Insufficient balance / funds ─────────────────────────
  {
    test: (msg) =>
      msg.includes('insufficient funds') ||
      msg.includes('insufficient balance') ||
      msg.includes('exceeds balance') ||
      msg.includes('transfer amount exceeds'),
    factory: (raw) =>
      new InsufficientBalanceError(raw.message, raw),
  },

  // ── Approval ─────────────────────────────────────────────
  {
    test: (msg) =>
      msg.includes('approve') &&
      (msg.includes('failed') || msg.includes('reverted')),
    factory: (raw) =>
      new ApprovalError(ErrorCode.APPROVAL_FAILED, raw.message, raw),
  },

  // ── No liquidity / pool not found ────────────────────────
  {
    test: (msg) =>
      msg.includes('no pool') ||
      msg.includes('no route') ||
      msg.includes('pool not found') ||
      msg.includes('liquidity'),
    factory: (raw) =>
      new QuoteError(ErrorCode.QUOTE_NO_LIQUIDITY, raw.message, raw),
  },

  // ── Quote errors (general revert from quoter) ────────────
  {
    test: (msg, name) =>
      name === 'ContractFunctionExecutionError' &&
      (msg.includes('quoter') || msg.includes('quote')),
    factory: (raw) =>
      new QuoteError(ErrorCode.QUOTE_NOT_FOUND, raw.message, raw),
  },

  // ── RPC timeout ──────────────────────────────────────────
  {
    test: (msg, name) =>
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      name === 'TimeoutError',
    factory: (raw) =>
      new TimeoutError(raw.message, raw),
  },

  // ── RPC rate limiting ────────────────────────────────────
  {
    test: (msg) =>
      msg.includes('429') ||
      msg.includes('rate limit') ||
      msg.includes('too many requests'),
    factory: (raw) =>
      new RateLimitError(raw.message, raw),
  },

  // ── Network / fetch errors ───────────────────────────────
  {
    test: (msg, name) =>
      msg.includes('fetch failed') ||
      msg.includes('network error') ||
      msg.includes('failed to fetch') ||
      msg.includes('econnrefused') ||
      name === 'TypeError',
    factory: (raw) =>
      new NetworkError(raw.message, raw),
  },
];

/**
 * Classify a raw error into a typed AppError.
 * If the error is already an AppError, returns it unchanged.
 *
 * @param error - Raw error from viem, ethers, wallet provider, or fetch
 * @param context - Optional context to improve classification
 * @returns Typed AppError
 */
export function classifyError(
  error: unknown,
  context?: ErrorContext,
): AppError {
  // Already classified
  if (isAppError(error)) return error;

  // Wrap non-Error values
  if (!(error instanceof Error)) {
    const msg = typeof error === 'string' ? error : 'An unknown error occurred';
    return new AppError(ErrorCode.UNKNOWN, msg, 'Something went wrong. Please try again.', true);
  }

  const msg = error.message.toLowerCase();
  const name = error.name ?? '';

  // Try pattern matching
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(msg, name)) {
      return pattern.factory(error);
    }
  }

  // Context-based fallback
  if (context?.operation) {
    switch (context.operation) {
      case 'connect':
      case 'disconnect':
        return new ConnectionError(error.message, error);
      case 'sign':
        return new SignatureError(error.message, error);
      case 'approve':
        return new ApprovalError(ErrorCode.APPROVAL_FAILED, error.message, error);
      case 'swap':
        return new SwapError(ErrorCode.UNKNOWN, error.message, 'Swap failed. Please try again.', true, error);
      case 'quote':
        return new QuoteError(ErrorCode.QUOTE_NOT_FOUND, error.message, error);
      case 'rpc':
      case 'balance':
        return new RPCError(ErrorCode.RPC_NETWORK_ERROR, error.message, 'Network request failed. Please try again.', error);
    }
  }

  // Fallback: generic
  return new AppError(
    ErrorCode.UNKNOWN,
    error.message,
    'Something went wrong. Please try again.',
    true,
    error,
  );
}

// ────────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────────

/**
 * Handle an error: classify, log, and notify UI.
 *
 * - User cancellations are logged but NOT shown as errors
 * - Recoverable errors show a warning toast
 * - Non-recoverable errors show an error toast
 * - `silent: true` suppresses the toast
 *
 * @param error - Raw or pre-classified error
 * @param context - Optional operation context
 * @returns The classified AppError (for further handling by the caller)
 */
export function handleError(
  error: unknown,
  context?: ErrorContext,
): AppError {
  const classified = classifyError(error, context);

  // ── Log (no sensitive data) ────────────────────────────────
  const entry: ErrorLogEntry = {
    code: classified.code,
    operation: context?.operation,
    chainId: context?.chainId,
    recoverable: classified.recoverable,
    timestamp: Date.now(),
  };

  errorLog.push(entry);
  if (errorLog.length > MAX_LOG_SIZE) {
    errorLog.splice(0, errorLog.length - MAX_LOG_SIZE);
  }

  // Console log for development (technical message, not user-facing)
  if (typeof console !== 'undefined') {
    console.error(
      `[error-handler] ${classified.code}: ${classified.message}`,
    );
  }

  // ── User cancellations: info log only, no error toast ──────
  if (isUserCancellation(classified)) {
    if (!context?.silent && notifier) {
      notifier({
        type: 'info',
        title: 'Cancelled',
        message: 'Action was cancelled.',
        suggestion: '',
      });
    }
    return classified;
  }

  // ── Notify UI ──────────────────────────────────────────────
  if (!context?.silent && notifier) {
    const msg = getErrorMessage(classified.code);
    notifier({
      type: classified.recoverable ? 'warning' : 'error',
      title: msg.title,
      message: msg.description,
      suggestion: msg.suggestion,
    });
  }

  return classified;
}
