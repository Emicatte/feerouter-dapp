/**
 * src/lib/errors/index.ts — Custom error type hierarchy
 *
 * Structured error classes for wallet, swap, and RPC operations.
 * Every error carries a machine-readable code, a technical message,
 * a user-facing message, and a recovery hint.
 *
 * @module errors
 */

// ────────────────────────────────────────────────────────────────
// Error codes (exhaustive enum)
// ────────────────────────────────────────────────────────────────

export enum ErrorCode {
  // ── Wallet ─────────────────────────────────────────────────
  WALLET_CONNECTION_FAILED = 'WALLET_CONNECTION_FAILED',
  WALLET_NOT_FOUND         = 'WALLET_NOT_FOUND',
  WALLET_USER_REJECTED     = 'WALLET_USER_REJECTED',
  CHAIN_UNSUPPORTED        = 'CHAIN_UNSUPPORTED',
  CHAIN_SWITCH_FAILED      = 'CHAIN_SWITCH_FAILED',
  SIGNATURE_REJECTED       = 'SIGNATURE_REJECTED',

  // ── Swap ───────────────────────────────────────────────────
  QUOTE_NOT_FOUND          = 'QUOTE_NOT_FOUND',
  QUOTE_NO_LIQUIDITY       = 'QUOTE_NO_LIQUIDITY',
  SLIPPAGE_EXCEEDED        = 'SLIPPAGE_EXCEEDED',
  INSUFFICIENT_BALANCE     = 'INSUFFICIENT_BALANCE',
  APPROVAL_FAILED          = 'APPROVAL_FAILED',
  APPROVAL_REJECTED        = 'APPROVAL_REJECTED',

  // ── RPC ────────────────────────────────────────────────────
  RPC_TIMEOUT              = 'RPC_TIMEOUT',
  RPC_RATE_LIMITED         = 'RPC_RATE_LIMITED',
  RPC_NETWORK_ERROR        = 'RPC_NETWORK_ERROR',

  // ── Generic ────────────────────────────────────────────────
  UNKNOWN                  = 'UNKNOWN',
}

// ────────────────────────────────────────────────────────────────
// Base class
// ────────────────────────────────────────────────────────────────

/**
 * Base application error. All domain-specific errors extend this.
 *
 * Properties:
 * - `code`        — machine-readable ErrorCode for programmatic handling
 * - `message`     — technical detail (never shown to user)
 * - `userMessage` — safe, human-readable description
 * - `recoverable` — whether the operation can be retried
 * - `cause`       — original error (if any)
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly recoverable: boolean;
  override readonly cause?: Error;

  constructor(
    code: ErrorCode,
    message: string,
    userMessage: string,
    recoverable: boolean,
    cause?: Error,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.recoverable = recoverable;
    this.cause = cause;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Return the user-facing message (ready for i18n override) */
  toUserMessage(): string {
    return this.userMessage;
  }
}

// ────────────────────────────────────────────────────────────────
// Wallet errors
// ────────────────────────────────────────────────────────────────

/** Wallet-related errors (connection, chain, signature) */
export class WalletError extends AppError {
  constructor(
    code: ErrorCode,
    message: string,
    userMessage: string,
    recoverable: boolean,
    cause?: Error,
  ) {
    super(code, message, userMessage, recoverable, cause);
    this.name = 'WalletError';
  }
}

/** Wallet provider not found or connection refused */
export class ConnectionError extends WalletError {
  constructor(message: string, cause?: Error) {
    super(
      ErrorCode.WALLET_CONNECTION_FAILED,
      message,
      'Unable to connect to your wallet. Please make sure your wallet extension is installed and unlocked.',
      true,
      cause,
    );
    this.name = 'ConnectionError';
  }
}

/** Target chain not supported or switch failed */
export class ChainError extends WalletError {
  readonly chainId?: number;

  constructor(
    code: ErrorCode.CHAIN_UNSUPPORTED | ErrorCode.CHAIN_SWITCH_FAILED,
    message: string,
    chainId?: number,
    cause?: Error,
  ) {
    const userMsg = code === ErrorCode.CHAIN_UNSUPPORTED
      ? 'This network is not supported. Please switch to a supported network.'
      : 'Failed to switch networks. Please switch manually in your wallet.';

    super(code, message, userMsg, true, cause);
    this.name = 'ChainError';
    this.chainId = chainId;
  }
}

/** User rejected a signature request */
export class SignatureError extends WalletError {
  constructor(message: string, cause?: Error) {
    super(
      ErrorCode.SIGNATURE_REJECTED,
      message,
      'Signature request was declined.',
      false,
      cause,
    );
    this.name = 'SignatureError';
  }
}

// ────────────────────────────────────────────────────────────────
// Swap errors
// ────────────────────────────────────────────────────────────────

/** Swap-related errors (quote, slippage, balance, approval) */
export class SwapError extends AppError {
  constructor(
    code: ErrorCode,
    message: string,
    userMessage: string,
    recoverable: boolean,
    cause?: Error,
  ) {
    super(code, message, userMessage, recoverable, cause);
    this.name = 'SwapError';
  }
}

/** No quote found for the requested pair */
export class QuoteError extends SwapError {
  constructor(
    code: ErrorCode.QUOTE_NOT_FOUND | ErrorCode.QUOTE_NO_LIQUIDITY,
    message: string,
    cause?: Error,
  ) {
    const userMsg = code === ErrorCode.QUOTE_NO_LIQUIDITY
      ? 'Insufficient liquidity for this trade. Try a smaller amount or a different token pair.'
      : 'Unable to find a route for this swap. The pair may not have an active pool.';

    super(code, message, userMsg, true, cause);
    this.name = 'QuoteError';
  }
}

/** Slippage tolerance exceeded during execution */
export class SlippageError extends SwapError {
  constructor(message: string, cause?: Error) {
    super(
      ErrorCode.SLIPPAGE_EXCEEDED,
      message,
      'Price moved beyond your slippage tolerance. Try increasing slippage or retry.',
      true,
      cause,
    );
    this.name = 'SlippageError';
  }
}

/** Insufficient token balance for the swap */
export class InsufficientBalanceError extends SwapError {
  constructor(message: string, cause?: Error) {
    super(
      ErrorCode.INSUFFICIENT_BALANCE,
      message,
      'You don\u2019t have enough tokens to complete this transaction.',
      false,
      cause,
    );
    this.name = 'InsufficientBalanceError';
  }
}

/** Token approval failed or was rejected */
export class ApprovalError extends SwapError {
  constructor(
    code: ErrorCode.APPROVAL_FAILED | ErrorCode.APPROVAL_REJECTED,
    message: string,
    cause?: Error,
  ) {
    const userMsg = code === ErrorCode.APPROVAL_REJECTED
      ? 'Token approval was declined. The swap cannot proceed without approval.'
      : 'Token approval failed. Please try again.';

    super(code, message, userMsg, code === ErrorCode.APPROVAL_FAILED, cause);
    this.name = 'ApprovalError';
  }
}

// ────────────────────────────────────────────────────────────────
// RPC errors
// ────────────────────────────────────────────────────────────────

/** RPC / network-level errors */
export class RPCError extends AppError {
  constructor(
    code: ErrorCode,
    message: string,
    userMessage: string,
    cause?: Error,
  ) {
    super(code, message, userMessage, true, cause);
    this.name = 'RPCError';
  }
}

/** RPC request timed out */
export class TimeoutError extends RPCError {
  constructor(message: string, cause?: Error) {
    super(
      ErrorCode.RPC_TIMEOUT,
      message,
      'The network request timed out. Please check your connection and try again.',
      cause,
    );
    this.name = 'TimeoutError';
  }
}

/** RPC rate limit exceeded */
export class RateLimitError extends RPCError {
  constructor(message: string, cause?: Error) {
    super(
      ErrorCode.RPC_RATE_LIMITED,
      message,
      'Too many requests. Please wait a moment and try again.',
      cause,
    );
    this.name = 'RateLimitError';
  }
}

/** General network/connectivity error */
export class NetworkError extends RPCError {
  constructor(message: string, cause?: Error) {
    super(
      ErrorCode.RPC_NETWORK_ERROR,
      message,
      'Network error. Please check your internet connection.',
      cause,
    );
    this.name = 'NetworkError';
  }
}

// ────────────────────────────────────────────────────────────────
// Type guards
// ────────────────────────────────────────────────────────────────

/** Check if an error is a known AppError */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Check if an error represents a user cancellation (not a real error) */
export function isUserCancellation(error: unknown): boolean {
  if (error instanceof AppError) {
    return (
      error.code === ErrorCode.WALLET_USER_REJECTED ||
      error.code === ErrorCode.SIGNATURE_REJECTED ||
      error.code === ErrorCode.APPROVAL_REJECTED
    );
  }

  // Raw wallet provider errors
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('user rejected') ||
      msg.includes('user denied') ||
      msg.includes('user cancelled') ||
      msg.includes('rejected the request') ||
      msg.includes('action_rejected')
    );
  }

  return false;
}
