/**
 * src/services/background/tx-watcher.ts — Transaction confirmation watcher
 *
 * Watches pending transactions until confirmed or failed.
 * Singleton pattern with event emitter, reorg detection,
 * adaptive polling (3s pending, 10s confirming), localStorage persistence,
 * and auto-cleanup of stale entries (>24h).
 */

import type { TransactionReceipt } from 'viem';
import type {
  TrackedTransaction,
  TxStatus,
  TxType,
  TxWatcherEvent,
  TxWatcherEventPayload,
  TxWatcherListener,
  SerializedTransaction,
} from '../../types/transaction';
import type { SupportedChainId } from '../../types/chain';
import { createEvmPublicClient } from '../../lib/evm/client';
import { VisibilityManager } from '../../lib/utils/visibility';
import { getSharedRpcGate } from '../../lib/utils/scheduler';

/** Existing export preserved */
export type TxWatcherCallback = (tx: TrackedTransaction, newStatus: TxStatus) => void;

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

/** Polling interval while tx is pending (ms) */
const PENDING_POLL_INTERVAL = 3_000;

/** Polling interval after first confirmation (ms) */
const CONFIRMING_POLL_INTERVAL = 10_000;

/** Auto-cleanup threshold (24 hours in ms) */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Max transactions per chain in localStorage */
const MAX_PERSISTED_PER_CHAIN = 100;

/** localStorage key prefix */
const STORAGE_KEY_PREFIX = 'wc-tx-history';

/** PROMPT 7: Background poll interval when tab is hidden/idle (ms) */
const BACKGROUND_POLL_INTERVAL = 15_000;

/** PROMPT 7: Max error backoff multiplier for poll failures */
const MAX_POLL_ERROR_BACKOFF = 8;

/** L2 chain IDs that need only 1 confirmation */
const L2_CHAIN_IDS: number[] = [10, 8453, 42161, 324, 81457, 84532];

/** Confirmations required for L1 chains */
const L1_CONFIRMATIONS = 2;

/** Confirmations required for L2 chains */
const L2_CONFIRMATIONS = 1;

// ────────────────────────────────────────────────────────────────
// TxWatcher Singleton
// ────────────────────────────────────────────────────────────────

/** Metadata for an actively watched transaction */
interface WatchEntry {
  tx: TrackedTransaction;
  timerId: ReturnType<typeof setTimeout> | null;
  /** Whether we've seen at least 1 confirmation */
  hasFirstConfirmation: boolean;
}

/**
 * Singleton transaction watcher.
 *
 * Watches pending transactions via polling, emits events on status changes,
 * handles reorgs, and persists history to localStorage.
 *
 * @example
 * ```ts
 * const watcher = TxWatcher.getInstance();
 * watcher.on('confirmed', (payload) => console.log('Confirmed:', payload.tx.hash));
 * watcher.watch(hash, 1, { type: 'swap', tokenIn: 'ETH', tokenOut: 'USDC' });
 * ```
 */
export class TxWatcher {
  private static instance: TxWatcher | null = null;

  /** Actively watched transactions (keyed by hash) */
  private watching = new Map<string, WatchEntry>();

  /** Event listeners */
  private listeners = new Map<TxWatcherEvent, Set<TxWatcherListener>>();

  /** Legacy callbacks (from original watchTransaction API) */
  private legacyCallbacks = new Map<string, TxWatcherCallback>();

  /** PROMPT 7: Per-tx consecutive error counts for backoff */
  private pollErrors = new Map<string, number>();

  /** PROMPT 7: Whether the tab is currently backgrounded or idle */
  private isBackgrounded = false;

  /** PROMPT 7: Visibility manager cleanup */
  private visibilityUnsub: (() => void) | null = null;

  private constructor() {
    // Restore pending transactions from localStorage on init
    this.restorePendingFromStorage();
    // PROMPT 7: Set up visibility-aware polling
    this.setupVisibility();
  }

  /** Get the singleton instance */
  static getInstance(): TxWatcher {
    if (!TxWatcher.instance) {
      TxWatcher.instance = new TxWatcher();
    }
    return TxWatcher.instance;
  }

  /**
   * Start watching a transaction.
   * @param hash - Transaction hash
   * @param chainId - Chain the transaction was submitted on
   * @param metadata - Additional metadata (type, token pair, etc.)
   */
  watch(
    hash: `0x${string}`,
    chainId: number,
    metadata: Record<string, unknown> & { type?: TxType } = {},
  ): void {
    const key = this.txKey(hash);

    // Don't double-watch
    if (this.watching.has(key)) return;

    const tx: TrackedTransaction = {
      hash,
      chainId,
      type: (metadata.type as TxType) ?? 'transfer',
      status: 'pending',
      timestamp: Date.now(),
      metadata,
      confirmations: 0,
    };

    const entry: WatchEntry = {
      tx,
      timerId: null,
      hasFirstConfirmation: false,
    };

    this.watching.set(key, entry);
    this.persistTransaction(tx);
    this.schedulePoll(key);
  }

  /**
   * Subscribe to a watcher event.
   * @param event - Event name
   * @param listener - Callback
   * @returns Unsubscribe function
   */
  on(event: TxWatcherEvent, listener: TxWatcherListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  /** Remove all listeners for an event (or all events) */
  off(event?: TxWatcherEvent): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /** Get all actively watched transactions */
  getWatching(): TrackedTransaction[] {
    return Array.from(this.watching.values()).map((e) => ({ ...e.tx }));
  }

  /** Stop watching a specific transaction */
  unwatch(hash: `0x${string}`): void {
    const key = this.txKey(hash);
    const entry = this.watching.get(key);
    if (entry?.timerId) {
      clearTimeout(entry.timerId);
    }
    this.watching.delete(key);
  }

  /** Stop watching all transactions */
  unwatchAll(): void {
    for (const [, entry] of this.watching) {
      if (entry.timerId) clearTimeout(entry.timerId);
    }
    this.watching.clear();
    this.pollErrors.clear();
  }

  /**
   * PROMPT 7: Full teardown — stop all watches, clean up listeners, reset singleton.
   * Call this on wallet disconnect for zero residual polling.
   */
  dispose(): void {
    this.unwatchAll();
    this.off();
    this.legacyCallbacks.clear();

    if (this.visibilityUnsub) {
      this.visibilityUnsub();
      this.visibilityUnsub = null;
    }

    TxWatcher.instance = null;
  }

  /**
   * Load persisted transaction history for a chain from localStorage.
   * @param chainId - Chain ID to load
   * @returns Array of serialized transactions, newest first
   */
  getHistory(chainId: number): SerializedTransaction[] {
    return this.readStorage(chainId);
  }

  /**
   * Clear persisted history for a chain (or all chains).
   * @param chainId - Optional chain to clear; omit for all
   */
  clearHistory(chainId?: number): void {
    if (chainId != null) {
      this.writeStorage(chainId, []);
    } else {
      try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith(STORAGE_KEY_PREFIX)) keys.push(k);
        }
        keys.forEach((k) => localStorage.removeItem(k));
      } catch { /* SSR or storage blocked */ }
    }
  }

  /**
   * Clean up stale transactions (> 24h) from active watching and storage.
   */
  cleanup(): void {
    const now = Date.now();

    // Clean active watchers
    for (const [key, entry] of this.watching) {
      if (now - entry.tx.timestamp > STALE_THRESHOLD_MS) {
        if (entry.timerId) clearTimeout(entry.timerId);
        this.watching.delete(key);
      }
    }

    // Clean persisted storage
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(STORAGE_KEY_PREFIX)) continue;
        const chainId = parseInt(k.replace(`${STORAGE_KEY_PREFIX}-`, ''), 10);
        if (isNaN(chainId)) continue;

        const txs = this.readStorage(chainId);
        const fresh = txs.filter((tx) => now - tx.timestamp <= STALE_THRESHOLD_MS);
        if (fresh.length !== txs.length) {
          this.writeStorage(chainId, fresh);
        }
      }
    } catch { /* SSR or storage blocked */ }
  }

  // ── Private ──────────────────────────────────────────────────

  /** Unique key for a transaction */
  private txKey(hash: `0x${string}`): string {
    return hash.toLowerCase();
  }

  /** Get required confirmations for a chain */
  private getRequiredConfirmations(chainId: number): number {
    return L2_CHAIN_IDS.includes(chainId) ? L2_CONFIRMATIONS : L1_CONFIRMATIONS;
  }

  /** Schedule the next poll for a watched transaction */
  private schedulePoll(key: string): void {
    const entry = this.watching.get(key);
    if (!entry) return;

    // Base interval depends on confirmation state
    let interval = entry.hasFirstConfirmation
      ? CONFIRMING_POLL_INTERVAL
      : PENDING_POLL_INTERVAL;

    // PROMPT 7: Background slowdown — use 15s min when tab hidden/idle
    if (this.isBackgrounded) {
      interval = Math.max(interval, BACKGROUND_POLL_INTERVAL);
    }

    // PROMPT 7: Error backoff — exponential on consecutive failures, capped
    const errorCount = this.pollErrors.get(key) ?? 0;
    if (errorCount > 0) {
      const backoff = Math.min(Math.pow(2, errorCount), MAX_POLL_ERROR_BACKOFF);
      interval = Math.round(interval * backoff);
    }

    entry.timerId = setTimeout(() => {
      // Use requestIdleCallback where available to avoid blocking main thread
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => this.poll(key));
      } else {
        this.poll(key);
      }
    }, interval);
  }

  /** Poll for transaction receipt and update state */
  private async poll(key: string): Promise<void> {
    const entry = this.watching.get(key);
    if (!entry) return;

    const { tx } = entry;

    try {
      const client = createEvmPublicClient(tx.chainId as SupportedChainId);
      const gate = getSharedRpcGate();
      let receipt: TransactionReceipt | null = null;

      try {
        // PROMPT 7: Concurrency-limited + deduplicated RPC call
        receipt = await gate.execute(
          `getReceipt:${tx.hash}`,
          () => client.getTransactionReceipt({ hash: tx.hash }),
        );
      } catch {
        // Receipt not available yet — still pending
      }

      if (!receipt) {
        // Check if tx was previously confirming — possible reorg
        if (entry.hasFirstConfirmation) {
          this.handleReorg(key, entry);
          return;
        }

        // Still pending, schedule next poll
        this.schedulePoll(key);
        return;
      }

      // Get current block for confirmation count
      // PROMPT 7: Deduplicate block-number calls across concurrent polls
      const currentBlock = await gate.execute(
        `blockNumber:${tx.chainId}`,
        () => client.getBlockNumber(),
      );
      const txBlock = receipt.blockNumber;
      const confirmations = Number(currentBlock - txBlock) + 1;
      const requiredConfirmations = this.getRequiredConfirmations(tx.chainId);

      // PROMPT 7: Reset error count on successful poll
      this.pollErrors.delete(key);

      // Update confirmation count
      const previousStatus = tx.status;
      tx.confirmations = confirmations;
      tx.receipt = receipt;

      if (receipt.status === 'reverted') {
        // Transaction failed on-chain
        tx.status = 'failed';
        tx.error = 'Transaction reverted';
        this.persistTransaction(tx);
        this.emit('failed', { tx: { ...tx }, event: 'failed', previousStatus });
        this.notifyLegacy(tx, 'failed');
        this.watching.delete(key);
        return;
      }

      if (confirmations >= requiredConfirmations) {
        // Fully confirmed
        tx.status = 'confirmed';
        this.persistTransaction(tx);
        this.emit('confirmed', { tx: { ...tx }, event: 'confirmed', previousStatus });
        this.notifyLegacy(tx, 'confirmed');
        this.watching.delete(key);
        return;
      }

      // Has confirmations but not enough yet
      entry.hasFirstConfirmation = true;
      tx.status = 'confirming';
      this.persistTransaction(tx);
      this.schedulePoll(key);
    } catch (err) {
      // PROMPT 7: Track consecutive errors for exponential backoff
      const prevErrors = (this.pollErrors.get(key) ?? 0) + 1;
      this.pollErrors.set(key, prevErrors);
      console.warn(
        `[TxWatcher] Poll error for ${tx.hash} (${prevErrors} consecutive): ${err instanceof Error ? err.message : String(err)}`,
      );
      this.schedulePoll(key);
    }
  }

  /** Handle a potential reorg (tx disappeared after confirmation) */
  private handleReorg(key: string, entry: WatchEntry): void {
    const { tx } = entry;
    const previousStatus = tx.status;

    console.warn(`[TxWatcher] Possible reorg detected for ${tx.hash}`);

    // Reset to pending state
    tx.status = 'pending';
    tx.confirmations = 0;
    tx.receipt = undefined;
    entry.hasFirstConfirmation = false;

    this.persistTransaction(tx);
    this.emit('reorg', { tx: { ...tx }, event: 'reorg', previousStatus });
    this.schedulePoll(key);
  }

  /** Emit an event to all registered listeners */
  private emit(event: TxWatcherEvent, payload: TxWatcherEventPayload): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error(`[TxWatcher] Listener error for '${event}':`, err);
      }
    }
  }

  /** Notify legacy callbacks */
  private notifyLegacy(tx: TrackedTransaction, newStatus: TxStatus): void {
    const cb = this.legacyCallbacks.get(this.txKey(tx.hash));
    if (cb) {
      try {
        cb(tx, newStatus);
      } catch (err) {
        console.error('[TxWatcher] Legacy callback error:', err);
      }
      this.legacyCallbacks.delete(this.txKey(tx.hash));
    }
  }

  // ── PROMPT 7: Visibility integration ──────────────────────────

  /** Set up visibility-aware polling (background slowdown + foreground resume) */
  private setupVisibility(): void {
    if (typeof document === 'undefined') return;

    try {
      const vm = VisibilityManager.getInstance();
      this.visibilityUnsub = vm.on((_event, state) => {
        const wasBackgrounded = this.isBackgrounded;
        this.isBackgrounded = state !== 'visible';

        // Tab returned to foreground → immediately reschedule all active watches
        if (wasBackgrounded && !this.isBackgrounded) {
          for (const [key, entry] of this.watching) {
            if (entry.timerId) {
              clearTimeout(entry.timerId);
              entry.timerId = null;
            }
            this.schedulePoll(key);
          }
        }
      });
    } catch {
      // VisibilityManager not available (SSR)
    }
  }

  // ── Persistence ──────────────────────────────────────────────

  /** Persist a transaction to localStorage */
  private persistTransaction(tx: TrackedTransaction): void {
    const serialized: SerializedTransaction = {
      hash: tx.hash,
      chainId: tx.chainId,
      type: tx.type,
      status: tx.status,
      timestamp: tx.timestamp,
      metadata: tx.metadata,
      confirmations: tx.confirmations,
      ...(tx.error ? { error: tx.error } : {}),
    };

    const existing = this.readStorage(tx.chainId);
    const idx = existing.findIndex(
      (t) => t.hash.toLowerCase() === tx.hash.toLowerCase(),
    );

    if (idx >= 0) {
      existing[idx] = serialized;
    } else {
      existing.unshift(serialized);
    }

    // Cap at MAX_PERSISTED_PER_CHAIN
    const capped = existing.slice(0, MAX_PERSISTED_PER_CHAIN);
    this.writeStorage(tx.chainId, capped);
  }

  /** Read transaction history from localStorage for a chain */
  private readStorage(chainId: number): SerializedTransaction[] {
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}-${chainId}`);
      if (!raw) return [];
      return JSON.parse(raw) as SerializedTransaction[];
    } catch {
      return [];
    }
  }

  /** Write transaction history to localStorage for a chain */
  private writeStorage(chainId: number, txs: SerializedTransaction[]): void {
    try {
      if (txs.length === 0) {
        localStorage.removeItem(`${STORAGE_KEY_PREFIX}-${chainId}`);
      } else {
        localStorage.setItem(
          `${STORAGE_KEY_PREFIX}-${chainId}`,
          JSON.stringify(txs),
        );
      }
    } catch { /* SSR or storage blocked */ }
  }

  /** Restore pending transactions from storage and resume watching */
  private restorePendingFromStorage(): void {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(STORAGE_KEY_PREFIX)) continue;

        const txs = JSON.parse(localStorage.getItem(k) ?? '[]') as SerializedTransaction[];
        for (const stx of txs) {
          if (stx.status === 'pending' || stx.status === 'confirming') {
            // Re-watch pending/confirming transactions
            const tx: TrackedTransaction = {
              hash: stx.hash,
              chainId: stx.chainId,
              type: stx.type,
              status: stx.status,
              timestamp: stx.timestamp,
              metadata: stx.metadata,
              confirmations: stx.confirmations,
              error: stx.error,
            };

            const key = this.txKey(tx.hash);
            if (!this.watching.has(key)) {
              const entry: WatchEntry = {
                tx,
                timerId: null,
                hasFirstConfirmation: stx.status === 'confirming',
              };
              this.watching.set(key, entry);
              this.schedulePoll(key);
            }
          }
        }
      }
    } catch { /* SSR or storage blocked */ }
  }

  /** Register a legacy callback (for backwards-compatible watchTransaction API) */
  registerLegacyCallback(hash: `0x${string}`, callback: TxWatcherCallback): void {
    this.legacyCallbacks.set(this.txKey(hash), callback);
  }
}

// ────────────────────────────────────────────────────────────────
// Legacy API (preserved from original stub)
// ────────────────────────────────────────────────────────────────

/**
 * Watch a transaction until it reaches a terminal state.
 * @param txHash - Transaction hash to watch
 * @param chainId - Chain the transaction was submitted on
 * @param onStatusChange - Callback for status updates
 * @returns Cleanup function to stop watching
 */
export function watchTransaction(
  txHash: `0x${string}`,
  chainId: number,
  onStatusChange: TxWatcherCallback,
): () => void {
  const watcher = TxWatcher.getInstance();
  watcher.watch(txHash, chainId);
  watcher.registerLegacyCallback(txHash, onStatusChange);
  return () => watcher.unwatch(txHash);
}
