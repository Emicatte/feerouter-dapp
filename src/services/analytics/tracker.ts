/**
 * src/services/analytics/tracker.ts — Privacy-respecting event tracking
 *
 * Tracks UI interactions and swap events without PII.
 */

/** Trackable event types */
export type EventType =
  | 'wallet_connect'
  | 'wallet_disconnect'
  | 'chain_switch'
  | 'swap_quote'
  | 'swap_execute'
  | 'swap_confirm'
  | 'swap_fail'
  | 'token_approve';

/** Event payload (no PII) */
export interface TrackEvent {
  type: EventType;
  chainId?: number;
  metadata?: Record<string, string | number | boolean>;
  timestamp: number;
}

/** In-memory event buffer */
const eventBuffer: TrackEvent[] = [];

/**
 * Track an analytics event.
 * @param type - Event type
 * @param metadata - Additional non-PII metadata
 */
export function trackEvent(
  type: EventType,
  metadata?: Record<string, string | number | boolean>,
): void {
  eventBuffer.push({
    type,
    metadata,
    timestamp: Date.now(),
  });
}

/**
 * Flush buffered events (e.g. to an analytics endpoint).
 * @returns The flushed events
 */
export function flushEvents(): TrackEvent[] {
  const events = [...eventBuffer];
  eventBuffer.length = 0;
  return events;
}

/**
 * Get the count of buffered events.
 */
export function getBufferedEventCount(): number {
  return eventBuffer.length;
}
