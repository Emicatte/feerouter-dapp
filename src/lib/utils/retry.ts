/**
 * src/lib/utils/retry.ts — Exponential backoff helper
 *
 * Generic retry wrapper for async operations.
 */

/** Retry configuration */
export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/** Default retry options */
export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * Retry an async function with exponential backoff.
 * @param fn - Async function to retry
 * @param options - Retry configuration
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries) break;

      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt),
        maxDelayMs,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

/** Promise-based sleep */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ────────────────────────────────────────────────────────────────
// Extended retry utility (PROMPT 5)
// ────────────────────────────────────────────────────────────────

/** Extended retry options with backoff factor, retryOn filter, and AbortSignal */
export interface RetryWithBackoffOptions {
  /** Maximum number of retries (default: 3) */
  maxRetries: number;
  /** Initial delay in ms before first retry (default: 1000) */
  initialDelay: number;
  /** Maximum delay cap in ms (default: 10000) */
  maxDelay: number;
  /** Backoff multiplier (default: 2) */
  backoffFactor: number;
  /** Optional predicate — only retry if this returns true for the error */
  retryOn?: (error: unknown, attempt: number) => boolean;
  /** Optional AbortSignal to cancel retries */
  signal?: AbortSignal;
  /** Optional label for log messages */
  label?: string;
}

/** Default retryWithBackoff options */
export const DEFAULT_BACKOFF_OPTIONS: Omit<RetryWithBackoffOptions, 'retryOn' | 'signal' | 'label'> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffFactor: 2,
};

/**
 * Retry an async function with configurable exponential backoff.
 *
 * Features beyond `withRetry`:
 * - `retryOn` predicate to selectively retry
 * - `AbortSignal` support for cancellation
 * - Console logging on each retry with reason
 *
 * @param fn - Async function to execute
 * @param options - Backoff configuration
 * @returns The resolved value of `fn`
 * @throws The last error if all retries are exhausted, or AbortError on cancellation
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: Partial<RetryWithBackoffOptions> = {},
): Promise<T> {
  const {
    maxRetries,
    initialDelay,
    maxDelay,
    backoffFactor,
    retryOn,
    signal,
    label,
  } = { ...DEFAULT_BACKOFF_OPTIONS, ...options };

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check abort before each attempt
    if (signal?.aborted) {
      throw new DOMException('Retry aborted', 'AbortError');
    }

    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Final attempt — do not retry
      if (attempt === maxRetries) break;

      // Check retryOn predicate
      if (retryOn && !retryOn(err, attempt)) {
        break;
      }

      const delay = Math.min(
        initialDelay * Math.pow(backoffFactor, attempt),
        maxDelay,
      );

      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[retry${label ? `:${label}` : ''}] Attempt ${attempt + 1}/${maxRetries} failed: ${reason}. Retrying in ${delay}ms...`,
      );

      // Abortable sleep
      await abortableSleep(delay, signal);
    }
  }

  throw lastError;
}

/**
 * Sleep that rejects early if the AbortSignal fires.
 * @internal
 */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms);

  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Retry aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('Retry aborted', 'AbortError'));
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}
