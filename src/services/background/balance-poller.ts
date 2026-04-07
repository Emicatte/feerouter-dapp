/**
 * src/services/background/balance-poller.ts — Balance polling service
 *
 * Periodically re-fetches token balances for the connected wallet.
 * Features: tab-visibility pause/resume, AbortController cleanup,
 * new-block detection for faster updates, configurable interval.
 */

import type { SupportedChainId } from '../../types/chain';
import { createEvmPublicClient } from '../../lib/evm/client';

/** Balance poller configuration */
export interface BalancePollerConfig {
  intervalMs: number;
  chainId: number;
  address: `0x${string}`;
}

/** Default poller interval (15 seconds) */
export const DEFAULT_POLL_INTERVAL = 15_000;

/**
 * Start polling balances for a wallet.
 * @param config - Poller configuration
 * @param onRefresh - Called on each refresh cycle
 * @returns Cleanup function to stop polling
 */
export function startBalancePoller(
  config: BalancePollerConfig,
  onRefresh?: () => void,
): () => void {
  const interval = setInterval(() => {
    onRefresh?.();
  }, config.intervalMs);

  return () => clearInterval(interval);
}

// ────────────────────────────────────────────────────────────────
// Enhanced balance poller with visibility + block watching (PROMPT 6)
// ────────────────────────────────────────────────────────────────

/** Enhanced poller configuration */
export interface EnhancedBalancePollerConfig {
  /** Polling interval in ms (default 30s) */
  intervalMs: number;
  /** Chain ID to poll on */
  chainId: SupportedChainId;
  /** Wallet address */
  address: `0x${string}`;
  /** Whether to also poll on new blocks (default false — more RPC calls) */
  watchBlocks: boolean;
}

/** Default enhanced config */
export const DEFAULT_ENHANCED_POLL_CONFIG: Omit<EnhancedBalancePollerConfig, 'address'> = {
  intervalMs: 30_000,
  chainId: 8453 as SupportedChainId,
  watchBlocks: false,
};

/**
 * Enhanced balance poller with tab-visibility pause and optional block watching.
 *
 * - Pauses when tab is hidden, resumes on focus
 * - Uses AbortController for clean teardown
 * - Optionally watches new blocks for near-instant balance updates
 * - Calls onRefresh callback each cycle (caller invalidates wagmi queries)
 *
 * @param config - Poller configuration
 * @param onRefresh - Called on each refresh cycle
 * @returns Cleanup function
 *
 * @see createScheduledBalancePoller for the scheduler-integrated version (PROMPT 7)
 */
export function startEnhancedBalancePoller(
  config: EnhancedBalancePollerConfig,
  onRefresh?: () => void,
): () => void {
  const controller = new AbortController();
  const { signal } = controller;

  let timerId: ReturnType<typeof setTimeout> | null = null;
  let isTabVisible = typeof document !== 'undefined' ? !document.hidden : true;
  let blockUnwatch: (() => void) | null = null;
  let lastBlockRefresh = 0;

  function refresh() {
    if (signal.aborted) return;
    onRefresh?.();
  }

  function scheduleNext() {
    if (signal.aborted || !isTabVisible) return;
    timerId = setTimeout(() => {
      refresh();
      scheduleNext();
    }, config.intervalMs);
  }

  function handleVisibilityChange() {
    if (signal.aborted) return;

    isTabVisible = !document.hidden;

    if (isTabVisible) {
      // Tab visible — refresh immediately and resume polling
      if (timerId) clearTimeout(timerId);
      refresh();
      scheduleNext();
    } else {
      // Tab hidden — pause
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
    }
  }

  // Register visibility listener
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  // Optional block watching
  if (config.watchBlocks) {
    try {
      const client = createEvmPublicClient(config.chainId);
      blockUnwatch = client.watchBlockNumber({
        onBlockNumber: () => {
          // Debounce: only refresh if >5s since last block-triggered refresh
          const now = Date.now();
          if (now - lastBlockRefresh > 5_000 && isTabVisible && !signal.aborted) {
            lastBlockRefresh = now;
            refresh();
          }
        },
        poll: true,
        pollingInterval: 12_000, // ~1 block on most chains
      });
    } catch {
      // Block watching unavailable — fall back to interval only
    }
  }

  // Start initial refresh + polling
  refresh();
  scheduleNext();

  // Cleanup
  return () => {
    controller.abort();
    if (timerId) clearTimeout(timerId);
    if (blockUnwatch) blockUnwatch();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  };
}

// ────────────────────────────────────────────────────────────────
// Scheduler-integrated balance poller (PROMPT 7)
// ────────────────────────────────────────────────────────────────

import { TaskScheduler, getSharedRpcGate } from '../../lib/utils/scheduler';

/** Configuration for the scheduler-integrated balance poller */
export interface ScheduledBalancePollerConfig {
  /** Chain ID to poll on */
  chainId: SupportedChainId;
  /** Wallet address */
  address: `0x${string}`;
  /** Foreground polling interval in ms (default 15s) */
  intervalMs?: number;
  /** Whether to also watch new blocks for near-instant updates (default false) */
  watchBlocks?: boolean;
}

/**
 * Scheduler-integrated balance poller.
 *
 * Advantages over `startEnhancedBalancePoller`:
 * - **Centralised scheduling** — managed by TaskScheduler (priority: medium)
 * - **Shared RPC gate** — respects the global max-3-concurrent limit
 * - **Automatic visibility** — pauses in background via TaskScheduler
 * - **Error backoff** — exponential backoff on RPC failures (built into scheduler)
 * - **Stale data tracking** — query via `TaskScheduler.getTaskStaleInfo('balance-poller-...')`
 * - **Zero FCP impact** — call after wallet connects
 * - **Complete cleanup** — returned function unregisters from scheduler
 *
 * @param config - Poller configuration
 * @param onRefresh - Called each cycle (e.g. invalidate wagmi queries)
 * @returns Cleanup function to stop polling
 *
 * @example
 * ```ts
 * const stop = createScheduledBalancePoller(
 *   { chainId: 8453, address: '0x...' },
 *   () => queryClient.invalidateQueries({ queryKey: ['balances'] }),
 * );
 * // On disconnect:
 * stop();
 * ```
 */
export function createScheduledBalancePoller(
  config: ScheduledBalancePollerConfig,
  onRefresh?: () => void,
): () => void {
  const scheduler = TaskScheduler.getInstance();
  const gate = getSharedRpcGate();

  const taskId = `balance-poller-${config.chainId}-${config.address.toLowerCase()}`;

  scheduler.register({
    id: taskId,
    priority: 'medium',
    intervalMs: config.intervalMs ?? 15_000,
    backgroundIntervalMs: null, // pause completely when tab hidden/idle
    execute: async () => {
      await gate.execute(
        `balanceRefresh:${config.chainId}:${config.address.toLowerCase()}`,
        async () => {
          onRefresh?.();
        },
      );
    },
  });

  // Optional block watching (with RPC gate for concurrency)
  let blockUnwatch: (() => void) | null = null;
  if (config.watchBlocks) {
    try {
      const client = createEvmPublicClient(config.chainId);
      let lastBlockRefresh = 0;

      blockUnwatch = client.watchBlockNumber({
        onBlockNumber: () => {
          const now = Date.now();
          // Debounce: only refresh if >5s since last block-triggered refresh
          if (now - lastBlockRefresh > 5_000) {
            lastBlockRefresh = now;
            gate.execute(
              `balanceRefresh:${config.chainId}:${config.address.toLowerCase()}`,
              async () => {
                onRefresh?.();
              },
            ).catch(() => {
              // Silent — scheduler handles backoff for interval-based polling
            });
          }
        },
        poll: true,
        pollingInterval: 12_000,
      });
    } catch {
      // Block watching unavailable — interval polling only
    }
  }

  return () => {
    scheduler.unregister(taskId);
    if (blockUnwatch) blockUnwatch();
  };
}
