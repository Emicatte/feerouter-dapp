/**
 * src/services/background/price-updater.ts — Periodic price refresh
 *
 * Background service that keeps the price cache warm.
 * Features: tab-visibility pause, AbortController cleanup,
 * localStorage persistence, and configurable token list.
 */

import { fetchPrices, type PriceMap } from '../../lib/price/oracle';
import { cachePrices, persistTopPrices } from '../../lib/price/cache';

/** Price updater configuration */
export interface PriceUpdaterConfig {
  coingeckoIds: string[];
  intervalMs: number;
}

/** Default config: 30-second refresh */
export const DEFAULT_PRICE_UPDATER_CONFIG: PriceUpdaterConfig = {
  coingeckoIds: ['ethereum', 'usd-coin', 'tether', 'dai', 'bitcoin', 'arbitrum', 'weth'],
  intervalMs: 30_000,
};

/**
 * Start the background price updater.
 * @param config - Updater configuration
 * @param onUpdate - Callback when prices are refreshed
 * @returns Cleanup function to stop the updater
 */
export function startPriceUpdater(
  config: PriceUpdaterConfig = DEFAULT_PRICE_UPDATER_CONFIG,
  onUpdate?: (prices: PriceMap) => void,
): () => void {
  let active = true;

  const tick = async () => {
    if (!active) return;
    try {
      const prices = await fetchPrices(config.coingeckoIds);
      cachePrices(prices);
      onUpdate?.(prices);
    } catch {
      // Silent retry on next tick
    }
  };

  tick();
  const interval = setInterval(tick, config.intervalMs);

  return () => {
    active = false;
    clearInterval(interval);
  };
}

// ────────────────────────────────────────────────────────────────
// Enhanced price updater with visibility + AbortController (PROMPT 6)
// ────────────────────────────────────────────────────────────────

/** Enhanced configuration */
export interface EnhancedPriceUpdaterConfig {
  /** CoinGecko token IDs to track */
  coingeckoIds: string[];
  /** Polling interval in ms (default 30s) */
  intervalMs: number;
  /** Whether to persist top prices to localStorage (default true) */
  persist: boolean;
}

/** Default enhanced config */
export const DEFAULT_ENHANCED_CONFIG: EnhancedPriceUpdaterConfig = {
  coingeckoIds: [
    'ethereum', 'bitcoin', 'usd-coin', 'tether', 'dai',
    'matic-network', 'binancecoin', 'avalanche-2', 'optimism', 'arbitrum',
  ],
  intervalMs: 30_000,
  persist: true,
};

/**
 * Enhanced background price updater with tab-visibility pause
 * and AbortController-based cleanup.
 *
 * - Pauses polling when tab is hidden (document.hidden)
 * - Resumes immediately when tab regains focus
 * - Uses AbortController for clean teardown
 * - Persists top-20 prices to localStorage each cycle
 *
 * @param config - Updater configuration
 * @param onUpdate - Callback on each successful price fetch
 * @returns Cleanup function
 *
 * @see createScheduledPriceUpdater for the scheduler-integrated version (PROMPT 7)
 */
export function startEnhancedPriceUpdater(
  config: EnhancedPriceUpdaterConfig = DEFAULT_ENHANCED_CONFIG,
  onUpdate?: (prices: PriceMap) => void,
): () => void {
  const controller = new AbortController();
  const { signal } = controller;

  let timerId: ReturnType<typeof setTimeout> | null = null;
  let isTabVisible = typeof document !== 'undefined' ? !document.hidden : true;

  async function tick() {
    if (signal.aborted) return;

    try {
      const prices = await fetchPrices(config.coingeckoIds);
      if (signal.aborted) return;

      cachePrices(prices);
      onUpdate?.(prices);

      if (config.persist) {
        persistTopPrices();
      }
    } catch {
      // Silent — retry on next tick
    }

    scheduleNext();
  }

  function scheduleNext() {
    if (signal.aborted) return;

    // Only schedule if tab is visible
    if (isTabVisible) {
      timerId = setTimeout(tick, config.intervalMs);
    }
  }

  function handleVisibilityChange() {
    if (signal.aborted) return;

    isTabVisible = !document.hidden;

    if (isTabVisible) {
      // Tab became visible — fetch immediately and resume polling
      if (timerId) clearTimeout(timerId);
      tick();
    } else {
      // Tab hidden — pause polling
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

  // Start first tick
  tick();

  // Cleanup
  return () => {
    controller.abort();
    if (timerId) clearTimeout(timerId);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  };
}

// ────────────────────────────────────────────────────────────────
// Scheduler-integrated price updater (PROMPT 7)
// ────────────────────────────────────────────────────────────────

import { TaskScheduler, getSharedRpcGate } from '../../lib/utils/scheduler';

/** Configuration for the scheduler-integrated price updater */
export interface ScheduledPriceUpdaterConfig {
  /** CoinGecko token IDs to track */
  coingeckoIds?: string[];
  /** Foreground polling interval in ms (default 30s) */
  intervalMs?: number;
  /** Whether to persist top prices to localStorage each cycle (default true) */
  persist?: boolean;
}

/**
 * Scheduler-integrated price updater.
 *
 * Advantages over `startEnhancedPriceUpdater`:
 * - **Centralised scheduling** — managed by TaskScheduler (priority: low)
 * - **Shared RPC gate** — respects the global max-3-concurrent limit
 * - **Automatic visibility** — pauses in background via TaskScheduler
 * - **Error backoff** — exponential backoff on fetch failures (built into scheduler)
 * - **requestIdleCallback** — low-priority execution avoids blocking UI
 * - **Stale data tracking** — query via `TaskScheduler.getTaskStaleInfo('price-updater')`
 * - **Zero FCP impact** — call after wallet connects
 * - **Complete cleanup** — returned function unregisters from scheduler
 *
 * @param config - Updater configuration
 * @param onUpdate - Callback on each successful price fetch
 * @returns Cleanup function to stop updating
 *
 * @example
 * ```ts
 * const stop = createScheduledPriceUpdater(
 *   { coingeckoIds: ['ethereum', 'bitcoin'] },
 *   (prices) => setPriceState(prices),
 * );
 * // On disconnect:
 * stop();
 * ```
 */
export function createScheduledPriceUpdater(
  config: ScheduledPriceUpdaterConfig = {},
  onUpdate?: (prices: PriceMap) => void,
): () => void {
  const scheduler = TaskScheduler.getInstance();
  const gate = getSharedRpcGate();

  const ids = config.coingeckoIds ?? DEFAULT_ENHANCED_CONFIG.coingeckoIds;
  const persist = config.persist !== false;
  const taskId = 'price-updater';

  scheduler.register({
    id: taskId,
    priority: 'low',
    intervalMs: config.intervalMs ?? 30_000,
    backgroundIntervalMs: null, // pause completely when tab hidden/idle
    execute: async () => {
      await gate.execute(
        `priceUpdate:${ids.join(',')}`,
        async () => {
          const prices = await fetchPrices(ids);
          cachePrices(prices);
          onUpdate?.(prices);

          if (persist) {
            persistTopPrices();
          }
        },
      );
    },
  });

  return () => {
    scheduler.unregister(taskId);
  };
}
