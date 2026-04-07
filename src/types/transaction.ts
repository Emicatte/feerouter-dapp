/**
 * src/types/transaction.ts — Transaction tracking types
 *
 * Status machine and metadata for tracking on-chain transactions
 * across their lifecycle.
 */

import type { TransactionReceipt } from 'viem';

/** Transaction lifecycle states */
export type TxStatus =
  | 'idle'
  | 'approving'
  | 'pending'
  | 'confirming'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

/** Transaction type discriminator */
export type TxType = 'swap' | 'approve' | 'transfer' | 'wrap' | 'unwrap';

/** A tracked on-chain transaction */
export interface TrackedTransaction {
  hash: `0x${string}`;
  chainId: number;
  type: TxType;
  status: TxStatus;
  timestamp: number;
  metadata: Record<string, unknown>;
  confirmations: number;
  receipt?: TransactionReceipt;
  error?: string;
}

/** Pending transaction before hash is known */
export interface PendingTransaction {
  chainId: number;
  type: TxType;
  timestamp: number;
  metadata: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────
// TxWatcher event types (PROMPT 5)
// ────────────────────────────────────────────────────────────────

/** Events emitted by TxWatcher */
export type TxWatcherEvent = 'confirmed' | 'failed' | 'speedUp' | 'cancelled' | 'reorg';

/** Payload for TxWatcher event callbacks */
export interface TxWatcherEventPayload {
  tx: TrackedTransaction;
  event: TxWatcherEvent;
  /** Previous status before this event */
  previousStatus: TxStatus;
}

/** Listener callback for TxWatcher events */
export type TxWatcherListener = (payload: TxWatcherEventPayload) => void;

/** Confirmation requirements per chain type */
export interface ConfirmationConfig {
  /** Chain IDs that are L2 (need 1 confirmation) */
  l2Chains: number[];
  /** Confirmations required for L1 */
  l1Confirmations: number;
  /** Confirmations required for L2 */
  l2Confirmations: number;
}

/** Serializable version of TrackedTransaction for localStorage */
export interface SerializedTransaction {
  hash: `0x${string}`;
  chainId: number;
  type: TxType;
  status: TxStatus;
  timestamp: number;
  metadata: Record<string, unknown>;
  confirmations: number;
  error?: string;
}

/** Gas estimation result */
export interface GasEstimate {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  estimatedCostWei: bigint;
  estimatedCostUsd: number | null;
}
