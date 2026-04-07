/**
 * src/lib/utils/scheduler.ts — Background task scheduler
 *
 * Centralised scheduler for background services with:
 * - Priority-based task management (high > medium > low)
 * - Concurrency-limited RPC gate (max 3 concurrent)
 * - Request deduplication (same key → shared promise)
 * - Request coalescing (50ms batching window)
 * - Visibility-aware interval adjustment
 * - Error backoff (exponential on consecutive failures)
 * - Stale data tracking (last update timestamps)
 */

import {
  VisibilityManager,
  type VisibilityState,
  type VisibilityEvent,
} from './visibility';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

/** Task priority levels */
export type TaskPriority = 'high' | 'medium' | 'low';

/** Numeric priority for sorting (lower = higher priority) */
const PRIORITY_ORDER: Record<TaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** Configuration for a scheduled task */
export interface TaskConfig {
  /** Unique task identifier */
  id: string;
  /** Task priority — affects execution order when resuming from background */
  priority: TaskPriority;
  /** Normal polling interval in ms (foreground) */
  intervalMs: number;
  /**
   * Interval when tab is hidden/idle.
   * - number: slowed-down interval
   * - null: pause completely in background
   */
  backgroundIntervalMs: number | null;
  /** The async work to execute each cycle */
  execute: () => Promise<void>;
}

/** Internal task state (not exported) */
interface TaskState {
  config: TaskConfig;
  timerId: ReturnType<typeof setTimeout> | null;
  lastRun: number;
  lastSuccess: number;
  consecutiveErrors: number;
  isRunning: boolean;
}

/** Stale data info for UI display */
export interface StaleInfo {
  /** Task ID */
  taskId: string;
  /** Timestamp of last successful execution (0 = never) */
  lastSuccess: number;
  /** Seconds since last success (-1 = never succeeded) */
  staleSec: number;
  /** Whether data is considered stale (>30s or never succeeded) */
  isStale: boolean;
}

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

/** Max concurrent RPC calls (global across all services) */
const MAX_CONCURRENT = 3;

/** Request coalescing window in ms */
const COALESCE_WINDOW_MS = 50;

/** Max error backoff multiplier (2^3 = 8x) */
const MAX_ERROR_BACKOFF = 8;

/** Stale threshold in seconds */
const STALE_THRESHOLD_SEC = 30;

// ────────────────────────────────────────────────────────────────
// RpcGate — Concurrency limiter + request deduplication
// ────────────────────────────────────────────────────────────────

/**
 * Concurrency-limited RPC executor with request deduplication.
 *
 * - Enforces a global limit of concurrent async calls (default 3)
 * - Identical keys share the same in-flight promise (dedup)
 * - Excess calls queue in FIFO order
 *
 * @example
 * ```ts
 * const gate = new RpcGate(3);
 * // Two calls with the same key → single RPC, shared result
 * const [a, b] = await Promise.all([
 *   gate.execute('eth_getBalance:0x123', () => client.getBalance({ address })),
 *   gate.execute('eth_getBalance:0x123', () => client.getBalance({ address })),
 * ]);
 * // a === b, only one RPC call made
 * ```
 */
export class RpcGate {
  /** In-flight promises keyed by dedup key */
  private inflight = new Map<string, Promise<unknown>>();

  /** Current number of active calls */
  private activeCount = 0;

  /** Maximum concurrent calls */
  private maxConcurrent: number;

  /** Queue of callers waiting for a slot */
  private waitQueue: Array<() => void> = [];

  constructor(maxConcurrent = MAX_CONCURRENT) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Execute an async call with dedup and concurrency limiting.
   *
   * If a call with the same `key` is already in-flight, returns
   * the existing promise instead of making a new call.
   *
   * @param key - Dedup key (same key = shared promise)
   * @param fn - The async function to execute
   * @returns The result of fn
   */
  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Dedup: return existing in-flight promise for same key
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    // Wait for a concurrency slot
    await this.acquire();

    const promise = fn().finally(() => {
      this.inflight.delete(key);
      this.release();
    });

    this.inflight.set(key, promise);
    return promise;
  }

  /** Number of currently active calls */
  get active(): number {
    return this.activeCount;
  }

  /** Number of calls waiting for a slot */
  get queued(): number {
    return this.waitQueue.length;
  }

  /** Acquire a concurrency slot (waits if at limit) */
  private acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.activeCount++;
        resolve();
      });
    });
  }

  /** Release a concurrency slot and wake next waiter */
  private release(): void {
    this.activeCount--;
    const next = this.waitQueue.shift();
    if (next) next();
  }
}

// ────────────────────────────────────────────────────────────────
// RequestCoalescer — 50ms batching window
// ────────────────────────────────────────────────────────────────

/** Pending coalesced request callbacks */
interface CoalescedRequest<T = unknown> {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/**
 * Batches individual requests within a configurable time window
 * into a single batch call.
 *
 * Callers request by key; after the coalescing window elapses,
 * all accumulated keys are passed to the batch function in one call.
 * This is ideal for combining multiple RPC reads into a single multicall.
 *
 * @example
 * ```ts
 * const coalescer = new RequestCoalescer(async (keys) => {
 *   const results = await multicall(keys.map(k => ({ target: k })));
 *   return new Map(keys.map((k, i) => [k, results[i]]));
 * });
 *
 * // These arrive within 50ms → batched into one multicall
 * const [a, b] = await Promise.all([
 *   coalescer.request('0xAAA'),
 *   coalescer.request('0xBBB'),
 * ]);
 * ```
 */
export class RequestCoalescer<T = unknown> {
  /** Pending requests keyed by request key */
  private pending = new Map<string, CoalescedRequest<T>[]>();

  /** Flush timer handle */
  private timerId: ReturnType<typeof setTimeout> | null = null;

  /** Batch execution function */
  private batchFn: (keys: string[]) => Promise<Map<string, T>>;

  /** Coalescing window duration */
  private windowMs: number;

  constructor(
    batchFn: (keys: string[]) => Promise<Map<string, T>>,
    windowMs = COALESCE_WINDOW_MS,
  ) {
    this.batchFn = batchFn;
    this.windowMs = windowMs;
  }

  /**
   * Request a value by key. Batched with other requests within the window.
   * @param key - Unique request key
   * @returns The resolved value for this key
   */
  request(key: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.pending.has(key)) {
        this.pending.set(key, []);
      }
      this.pending.get(key)!.push({ resolve, reject });
      this.scheduleFlush();
    });
  }

  /** Number of unique keys waiting to be flushed */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Cancel pending flush and reject all waiters */
  cancel(): void {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    const err = new Error('RequestCoalescer cancelled');
    for (const [, waiters] of this.pending) {
      for (const w of waiters) w.reject(err);
    }
    this.pending.clear();
  }

  /** Schedule a flush after the coalescing window */
  private scheduleFlush(): void {
    if (this.timerId) return;
    this.timerId = setTimeout(() => this.flush(), this.windowMs);
  }

  /** Execute the batch function with all accumulated keys */
  private async flush(): Promise<void> {
    this.timerId = null;

    // Snapshot and clear pending
    const batch = new Map(this.pending);
    this.pending.clear();

    const keys = Array.from(batch.keys());
    if (keys.length === 0) return;

    try {
      const results = await this.batchFn(keys);

      for (const [key, waiters] of batch) {
        const value = results.get(key);
        if (value !== undefined) {
          for (const w of waiters) w.resolve(value);
        } else {
          const err = new Error(`No result for coalesced key: ${key}`);
          for (const w of waiters) w.reject(err);
        }
      }
    } catch (err) {
      for (const [, waiters] of batch) {
        for (const w of waiters) w.reject(err);
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────
// Shared RPC Gate (module-level singleton)
// ────────────────────────────────────────────────────────────────

/** Lazily-initialised shared RPC gate */
let _sharedGate: RpcGate | null = null;

/**
 * Get the shared RPC gate for concurrency-limited, deduplicated calls.
 *
 * All background services should use this gate to enforce the
 * global max-3-concurrent-RPC-calls limit.
 */
export function getSharedRpcGate(): RpcGate {
  if (!_sharedGate) {
    _sharedGate = new RpcGate(MAX_CONCURRENT);
  }
  return _sharedGate;
}

// ────────────────────────────────────────────────────────────────
// TaskScheduler — Centralised background task manager
// ────────────────────────────────────────────────────────────────

/**
 * Centralised task scheduler for background services.
 *
 * Manages multiple periodic tasks with:
 * - **Priority ordering** — high-priority tasks execute first when resuming
 * - **Visibility-aware scheduling** — pause or slow down in background, resume on focus
 * - **Error backoff** — exponential on consecutive failures, capped at 8×
 * - **Stale data tracking** — per-task last-success timestamps for UI indicators
 * - **Zero FCP impact** — tasks only start after explicit registration (post wallet-connect)
 * - **Complete cleanup** — `dispose()` clears all timers and listeners
 *
 * @example
 * ```ts
 * const scheduler = TaskScheduler.getInstance();
 *
 * scheduler.register({
 *   id: 'tx-watcher',
 *   priority: 'high',
 *   intervalMs: 3_000,
 *   backgroundIntervalMs: 15_000, // slow, not paused
 *   execute: async () => { await pollPendingTxs(); },
 * });
 *
 * scheduler.register({
 *   id: 'balance-poller',
 *   priority: 'medium',
 *   intervalMs: 15_000,
 *   backgroundIntervalMs: null, // pause completely
 *   execute: async () => { await refreshBalances(); },
 * });
 *
 * // On wallet disconnect:
 * scheduler.dispose();
 * ```
 */
export class TaskScheduler {
  private static instance: TaskScheduler | null = null;

  /** Registered tasks */
  private tasks = new Map<string, TaskState>();

  /** Shared RPC gate */
  private rpcGate: RpcGate;

  /** VisibilityManager subscription cleanup */
  private visibilityUnsub: (() => void) | null = null;

  /** Whether dispose() has been called */
  private disposed = false;

  private constructor() {
    this.rpcGate = getSharedRpcGate();
    this.setupVisibility();
  }

  /** Get the singleton instance */
  static getInstance(): TaskScheduler {
    if (!TaskScheduler.instance) {
      TaskScheduler.instance = new TaskScheduler();
    }
    return TaskScheduler.instance;
  }

  /**
   * Get the shared RPC gate for concurrency-limited, deduplicated calls.
   * Services should route all RPC calls through this gate.
   */
  getRpcGate(): RpcGate {
    return this.rpcGate;
  }

  /**
   * Register and start a periodic task.
   *
   * If a task with the same ID exists, it is unregistered first.
   * The task executes immediately on registration, then on its interval.
   *
   * @param config - Task configuration
   */
  register(config: TaskConfig): void {
    if (this.disposed) return;

    // Replace existing task with same ID
    if (this.tasks.has(config.id)) {
      this.unregister(config.id);
    }

    const state: TaskState = {
      config,
      timerId: null,
      lastRun: 0,
      lastSuccess: 0,
      consecutiveErrors: 0,
      isRunning: false,
    };

    this.tasks.set(config.id, state);

    // Execute immediately, then schedule next
    this.executeTask(state);
  }

  /**
   * Unregister and stop a task.
   * @param taskId - The task ID to remove
   */
  unregister(taskId: string): void {
    const state = this.tasks.get(taskId);
    if (!state) return;

    if (state.timerId) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }
    this.tasks.delete(taskId);
  }

  /** Unregister all tasks and clear all timers */
  unregisterAll(): void {
    for (const [, state] of this.tasks) {
      if (state.timerId) {
        clearTimeout(state.timerId);
        state.timerId = null;
      }
    }
    this.tasks.clear();
  }

  /**
   * Force an immediate execution of a specific task.
   * No-op if the task is currently running.
   * @param taskId - The task ID to trigger
   */
  async trigger(taskId: string): Promise<void> {
    const state = this.tasks.get(taskId);
    if (!state || state.isRunning) return;

    // Cancel pending scheduled run
    if (state.timerId) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }

    await this.executeTask(state);
  }

  /**
   * Get stale data info for all registered tasks.
   * Useful for UI "last updated X seconds ago" indicators.
   * @returns Array of StaleInfo sorted by staleness (most stale first)
   */
  getStaleInfo(): StaleInfo[] {
    const now = Date.now();
    const result: StaleInfo[] = [];

    for (const [, state] of this.tasks) {
      const staleSec = state.lastSuccess > 0
        ? Math.round((now - state.lastSuccess) / 1000)
        : -1;

      result.push({
        taskId: state.config.id,
        lastSuccess: state.lastSuccess,
        staleSec,
        isStale: staleSec > STALE_THRESHOLD_SEC || staleSec === -1,
      });
    }

    return result.sort((a, b) => b.staleSec - a.staleSec);
  }

  /**
   * Get stale info for a specific task.
   * @param taskId - The task ID
   * @returns StaleInfo or null if task not found
   */
  getTaskStaleInfo(taskId: string): StaleInfo | null {
    const state = this.tasks.get(taskId);
    if (!state) return null;

    const now = Date.now();
    const staleSec = state.lastSuccess > 0
      ? Math.round((now - state.lastSuccess) / 1000)
      : -1;

    return {
      taskId: state.config.id,
      lastSuccess: state.lastSuccess,
      staleSec,
      isStale: staleSec > STALE_THRESHOLD_SEC || staleSec === -1,
    };
  }

  /** Whether the scheduler has any registered tasks */
  get hasActiveTasks(): boolean {
    return this.tasks.size > 0;
  }

  /** Number of registered tasks */
  get taskCount(): number {
    return this.tasks.size;
  }

  /** Dispose the scheduler: stop all tasks, remove listeners, reset singleton */
  dispose(): void {
    this.disposed = true;
    this.unregisterAll();

    if (this.visibilityUnsub) {
      this.visibilityUnsub();
      this.visibilityUnsub = null;
    }

    TaskScheduler.instance = null;
  }

  // ── Private ──────────────────────────────────────────────────

  /** Subscribe to VisibilityManager for pause/resume */
  private setupVisibility(): void {
    try {
      const manager = VisibilityManager.getInstance();
      this.visibilityUnsub = manager.on((event: VisibilityEvent, newState: VisibilityState) => {
        this.handleVisibilityChange(event, newState);
      });
    } catch {
      // VisibilityManager not available (SSR)
    }
  }

  /** React to visibility state changes */
  private handleVisibilityChange(_event: VisibilityEvent, newState: VisibilityState): void {
    if (this.disposed) return;

    if (newState === 'visible') {
      // Tab active — refresh all tasks immediately, priority order
      this.refreshAllByPriority();
    } else {
      // Tab hidden or idle — reschedule with background intervals
      this.rescheduleAll();
    }
  }

  /** Refresh all tasks in priority order (high → medium → low) */
  private refreshAllByPriority(): void {
    const sorted = Array.from(this.tasks.values()).sort(
      (a, b) => PRIORITY_ORDER[a.config.priority] - PRIORITY_ORDER[b.config.priority],
    );

    for (const state of sorted) {
      if (state.timerId) {
        clearTimeout(state.timerId);
        state.timerId = null;
      }
      // Execute immediately on resume
      this.executeTask(state);
    }
  }

  /** Reschedule all tasks with background-appropriate intervals */
  private rescheduleAll(): void {
    for (const [, state] of this.tasks) {
      if (state.timerId) {
        clearTimeout(state.timerId);
        state.timerId = null;
      }

      if (!state.isRunning) {
        this.scheduleNext(state);
      }
    }
  }

  /** Execute a task and schedule the next run */
  private async executeTask(state: TaskState): Promise<void> {
    if (this.disposed || state.isRunning) return;
    // Check task is still registered
    if (!this.tasks.has(state.config.id)) return;

    state.isRunning = true;
    state.lastRun = Date.now();

    try {
      await state.config.execute();
      state.consecutiveErrors = 0;
      state.lastSuccess = Date.now();
    } catch (err) {
      state.consecutiveErrors++;
      console.warn(
        `[Scheduler] Task '${state.config.id}' failed (${state.consecutiveErrors} consecutive):`,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      state.isRunning = false;
      // Only schedule if still registered
      if (this.tasks.has(state.config.id)) {
        this.scheduleNext(state);
      }
    }
  }

  /** Schedule the next execution of a task */
  private scheduleNext(state: TaskState): void {
    if (this.disposed) return;
    if (!this.tasks.has(state.config.id)) return;

    // Determine interval based on visibility
    const vm = VisibilityManager.getInstance();
    const isReduced = vm.isReduced();

    let interval: number;

    if (isReduced) {
      if (state.config.backgroundIntervalMs === null) {
        // Task pauses completely in background — don't schedule
        return;
      }
      interval = state.config.backgroundIntervalMs;
    } else {
      interval = state.config.intervalMs;
    }

    // Error backoff: multiply interval by min(2^errors, MAX_ERROR_BACKOFF)
    if (state.consecutiveErrors > 0) {
      const backoff = Math.min(
        Math.pow(2, state.consecutiveErrors),
        MAX_ERROR_BACKOFF,
      );
      interval = Math.round(interval * backoff);
    }

    state.timerId = setTimeout(() => {
      // Use requestIdleCallback for low-priority tasks to avoid blocking UI
      if (
        state.config.priority === 'low' &&
        typeof requestIdleCallback === 'function'
      ) {
        requestIdleCallback(() => this.executeTask(state));
      } else {
        this.executeTask(state);
      }
    }, interval);
  }
}
