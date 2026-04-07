/**
 * src/lib/errors/messages.ts — User-friendly error messages
 *
 * Maps error codes to human-readable messages with suggested actions.
 * English default; structured for future i18n.
 *
 * @module errors/messages
 */

import { ErrorCode } from './index';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

/** A user-facing error message with recovery guidance */
export interface ErrorMessage {
  /** Short title for the error (e.g. toast heading) */
  title: string;
  /** Longer explanation of what happened */
  description: string;
  /** Suggested action the user can take */
  suggestion: string;
}

// ────────────────────────────────────────────────────────────────
// Message map
// ────────────────────────────────────────────────────────────────

/**
 * Complete mapping of ErrorCode → user-friendly messages.
 * All strings are in English. Wrap with a translation function
 * (e.g. `t()`) at the call site for i18n.
 */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, ErrorMessage>> = {
  // ── Wallet ─────────────────────────────────────────────────
  [ErrorCode.WALLET_CONNECTION_FAILED]: {
    title: 'Connection failed',
    description: 'Unable to connect to your wallet.',
    suggestion: 'Make sure your wallet extension is installed and unlocked, then try again.',
  },
  [ErrorCode.WALLET_NOT_FOUND]: {
    title: 'Wallet not found',
    description: 'No compatible wallet was detected in your browser.',
    suggestion: 'Install a wallet like MetaMask or Coinbase Wallet, then refresh the page.',
  },
  [ErrorCode.WALLET_USER_REJECTED]: {
    title: 'Connection cancelled',
    description: 'You declined the connection request.',
    suggestion: 'Click "Connect Wallet" to try again when you\u2019re ready.',
  },
  [ErrorCode.CHAIN_UNSUPPORTED]: {
    title: 'Unsupported network',
    description: 'The selected network is not supported by this app.',
    suggestion: 'Switch to a supported network like Ethereum, Base, or Arbitrum.',
  },
  [ErrorCode.CHAIN_SWITCH_FAILED]: {
    title: 'Network switch failed',
    description: 'Unable to switch networks automatically.',
    suggestion: 'Open your wallet and switch networks manually.',
  },
  [ErrorCode.SIGNATURE_REJECTED]: {
    title: 'Signature declined',
    description: 'You declined the signature request.',
    suggestion: 'You can retry the action when you\u2019re ready to sign.',
  },

  // ── Swap ───────────────────────────────────────────────────
  [ErrorCode.QUOTE_NOT_FOUND]: {
    title: 'No route found',
    description: 'No swap route was found for this token pair.',
    suggestion: 'This pair may not have a liquidity pool. Try a different pair or amount.',
  },
  [ErrorCode.QUOTE_NO_LIQUIDITY]: {
    title: 'Insufficient liquidity',
    description: 'There isn\u2019t enough liquidity to complete this trade.',
    suggestion: 'Try reducing the swap amount or choose a more liquid pair.',
  },
  [ErrorCode.SLIPPAGE_EXCEEDED]: {
    title: 'Price changed',
    description: 'The price moved beyond your slippage tolerance while the transaction was pending.',
    suggestion: 'Increase your slippage tolerance in Settings, or try again when the market is less volatile.',
  },
  [ErrorCode.INSUFFICIENT_BALANCE]: {
    title: 'Insufficient balance',
    description: 'You don\u2019t have enough tokens for this transaction.',
    suggestion: 'Reduce the amount or add more tokens to your wallet.',
  },
  [ErrorCode.APPROVAL_FAILED]: {
    title: 'Approval failed',
    description: 'The token approval transaction failed on-chain.',
    suggestion: 'Try approving again. If the issue persists, check your gas settings.',
  },
  [ErrorCode.APPROVAL_REJECTED]: {
    title: 'Approval declined',
    description: 'You declined the token approval request.',
    suggestion: 'The swap requires token approval. Approve the token to continue.',
  },

  // ── RPC ────────────────────────────────────────────────────
  [ErrorCode.RPC_TIMEOUT]: {
    title: 'Request timed out',
    description: 'The network request took too long to respond.',
    suggestion: 'Check your internet connection and try again.',
  },
  [ErrorCode.RPC_RATE_LIMITED]: {
    title: 'Too many requests',
    description: 'You\u2019re sending requests too quickly.',
    suggestion: 'Wait a few seconds and try again.',
  },
  [ErrorCode.RPC_NETWORK_ERROR]: {
    title: 'Network error',
    description: 'Unable to reach the blockchain network.',
    suggestion: 'Check your internet connection. The RPC endpoint may be temporarily unavailable.',
  },

  // ── Generic ────────────────────────────────────────────────
  [ErrorCode.UNKNOWN]: {
    title: 'Something went wrong',
    description: 'An unexpected error occurred.',
    suggestion: 'Please try again. If the problem continues, refresh the page.',
  },
};

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/**
 * Get the user-friendly message for an error code.
 * Falls back to UNKNOWN for unrecognized codes.
 *
 * @param code - ErrorCode value
 * @returns ErrorMessage with title, description, and suggestion
 */
export function getErrorMessage(code: ErrorCode): ErrorMessage {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES[ErrorCode.UNKNOWN];
}

/**
 * Format a single-line user message from an error code.
 * Combines description + suggestion.
 *
 * @param code - ErrorCode value
 */
export function formatErrorMessage(code: ErrorCode): string {
  const msg = getErrorMessage(code);
  return `${msg.description} ${msg.suggestion}`;
}
