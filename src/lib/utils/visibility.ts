/**
 * src/lib/utils/visibility.ts — Page visibility & idle detection
 *
 * Centralised visibility state management:
 * - VisibilityManager singleton with event emitter
 * - usePageVisibility() React hook (useSyncExternalStore)
 * - Idle detection (no input for 5 min → idle state)
 * - Integration point for TaskScheduler pause/resume
 */

'use client';

import { useCallback, useSyncExternalStore } from 'react';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

/** Page visibility states */
export type VisibilityState = 'visible' | 'hidden' | 'idle';

/** Events emitted by VisibilityManager */
export type VisibilityEvent = 'visible' | 'hidden' | 'idle' | 'active';

/** Listener callback for visibility changes */
export type VisibilityListener = (event: VisibilityEvent, state: VisibilityState) => void;

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

/** Default idle timeout: 5 minutes */
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** User-activity events that reset the idle timer */
const ACTIVITY_EVENTS: string[] = [
  'mousedown',
  'mousemove',
  'keydown',
  'scroll',
  'touchstart',
  'pointerdown',
];

// ────────────────────────────────────────────────────────────────
// VisibilityManager Singleton
// ────────────────────────────────────────────────────────────────

/**
 * Centralised visibility + idle state manager.
 *
 * Tracks document visibility and user activity to provide a unified
 * state that background services can subscribe to:
 *
 * | State     | Meaning                                      |
 * |-----------|----------------------------------------------|
 * | `visible` | Tab active, user interacting                  |
 * | `hidden`  | Tab not visible (document.hidden === true)    |
 * | `idle`    | Tab visible but no user activity for 5 min    |
 *
 * @example
 * ```ts
 * const vm = VisibilityManager.getInstance();
 * const unsub = vm.on((event, state) => {
 *   if (state === 'hidden' || state === 'idle') pausePolling();
 *   else resumePolling();
 * });
 * // later:
 * unsub();
 * ```
 */
export class VisibilityManager {
  private static instance: VisibilityManager | null = null;

  /** Current state */
  private _state: VisibilityState = 'visible';

  /** Subscribed listeners */
  private listeners = new Set<VisibilityListener>();

  /** Idle timer handle */
  private idleTimerId: ReturnType<typeof setTimeout> | null = null;

  /** Idle timeout duration */
  private idleTimeoutMs: number;

  /** Bound handlers (for cleanup) */
  private boundVisibilityHandler: (() => void) | null = null;
  private boundActivityHandler: (() => void) | null = null;

  /** Whether dispose() has been called */
  private disposed = false;

  private constructor(idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS) {
    this.idleTimeoutMs = idleTimeoutMs;
    this.setup();
  }

  /** Get the singleton instance */
  static getInstance(): VisibilityManager {
    if (!VisibilityManager.instance) {
      VisibilityManager.instance = new VisibilityManager();
    }
    return VisibilityManager.instance;
  }

  /** Current visibility state */
  getState(): VisibilityState {
    return this._state;
  }

  /** Whether the page is in an active state (visible + not idle) */
  isActive(): boolean {
    return this._state === 'visible';
  }

  /** Whether the page is in a reduced state (hidden or idle) */
  isReduced(): boolean {
    return this._state === 'hidden' || this._state === 'idle';
  }

  /**
   * Subscribe to visibility changes.
   * @param listener - Callback receiving (event, newState)
   * @returns Unsubscribe function
   */
  on(listener: VisibilityListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Remove all listeners */
  off(): void {
    this.listeners.clear();
  }

  /** Clean up all event listeners and timers. Resets singleton. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();

    if (this.idleTimerId) {
      clearTimeout(this.idleTimerId);
      this.idleTimerId = null;
    }

    if (typeof document !== 'undefined') {
      if (this.boundVisibilityHandler) {
        document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
      }
      if (this.boundActivityHandler) {
        for (const evt of ACTIVITY_EVENTS) {
          document.removeEventListener(evt, this.boundActivityHandler);
        }
      }
    }

    VisibilityManager.instance = null;
  }

  // ── Private ──────────────────────────────────────────────────

  /** Initialise event listeners for visibility and activity tracking */
  private setup(): void {
    if (typeof document === 'undefined') return;

    // Initial state
    this._state = document.hidden ? 'hidden' : 'visible';

    // Visibility change handler
    this.boundVisibilityHandler = () => {
      if (this.disposed) return;

      if (document.hidden) {
        this.setState('hidden', 'hidden');
        this.clearIdleTimer();
      } else {
        this.setState('visible', 'visible');
        this.resetIdleTimer();
      }
    };
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);

    // Activity handler — resets idle timer on any user input
    this.boundActivityHandler = () => {
      if (this.disposed) return;

      // If currently idle, transition back to visible
      if (this._state === 'idle') {
        this.setState('visible', 'active');
      }
      this.resetIdleTimer();
    };
    for (const evt of ACTIVITY_EVENTS) {
      document.addEventListener(evt, this.boundActivityHandler, { passive: true });
    }

    // Start idle timer
    this.resetIdleTimer();
  }

  /** Transition state and notify listeners */
  private setState(newState: VisibilityState, event: VisibilityEvent): void {
    if (this._state === newState) return;

    this._state = newState;
    for (const listener of this.listeners) {
      try {
        listener(event, newState);
      } catch (err) {
        console.error('[VisibilityManager] Listener error:', err);
      }
    }
  }

  /** Reset the idle countdown */
  private resetIdleTimer(): void {
    this.clearIdleTimer();

    // Only set idle timer when tab is visible
    if (this._state !== 'hidden') {
      this.idleTimerId = setTimeout(() => {
        if (!this.disposed && this._state === 'visible') {
          this.setState('idle', 'idle');
        }
      }, this.idleTimeoutMs);
    }
  }

  /** Clear the idle timer without starting a new one */
  private clearIdleTimer(): void {
    if (this.idleTimerId) {
      clearTimeout(this.idleTimerId);
      this.idleTimerId = null;
    }
  }
}

// ────────────────────────────────────────────────────────────────
// React Hook: usePageVisibility
// ────────────────────────────────────────────────────────────────

/** Return type for usePageVisibility */
export interface UsePageVisibilityReturn {
  /** Current visibility state */
  state: VisibilityState;
  /** Whether page is actively visible and user is interacting */
  isActive: boolean;
  /** Whether page is in reduced mode (hidden or idle) */
  isReduced: boolean;
}

/**
 * React hook that tracks page visibility and idle state.
 *
 * Uses `useSyncExternalStore` for tear-free reads in concurrent mode.
 *
 * @example
 * ```tsx
 * function Dashboard() {
 *   const { isActive, state } = usePageVisibility();
 *   if (!isActive) return <StaleDataBanner lastUpdate={...} />;
 *   return <LiveDashboard />;
 * }
 * ```
 */
export function usePageVisibility(): UsePageVisibilityReturn {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const manager = VisibilityManager.getInstance();
    return manager.on(() => onStoreChange());
  }, []);

  const getSnapshot = useCallback((): VisibilityState => {
    return VisibilityManager.getInstance().getState();
  }, []);

  const getServerSnapshot = useCallback((): VisibilityState => {
    return 'visible';
  }, []);

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return {
    state,
    isActive: state === 'visible',
    isReduced: state === 'hidden' || state === 'idle',
  };
}
