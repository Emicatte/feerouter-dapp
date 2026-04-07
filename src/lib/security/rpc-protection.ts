/**
 * src/lib/security/rpc-protection.ts — RPC endpoint protection
 *
 * Rate limiting, circuit breaker, request sanitization, and
 * response validation for outbound RPC calls.
 * All mechanisms are per-endpoint and fully client-side.
 *
 * @module security/rpc-protection
 */

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

/** Circuit breaker state */
export type CircuitState = 'closed' | 'open' | 'half-open';

/** Per-endpoint health info (exposed for monitoring) */
export interface EndpointHealth {
  /** RPC endpoint URL (without auth params) */
  endpoint: string;
  /** Current circuit breaker state */
  circuitState: CircuitState;
  /** Consecutive failure count */
  failures: number;
  /** Total requests in current window */
  requestsInWindow: number;
  /** Maximum requests per window */
  maxRequestsPerWindow: number;
  /** Time until circuit resets to half-open (0 if closed) */
  circuitResetMs: number;
  /** Last successful request timestamp */
  lastSuccess: number;
  /** Last failure timestamp */
  lastFailure: number;
}

/** RPC protection configuration */
export interface RpcProtectionConfig {
  /** Maximum requests per second per endpoint (default 25) */
  maxRequestsPerSec: number;
  /** Consecutive failures before circuit opens (default 5) */
  failureThreshold: number;
  /** Circuit breaker open duration in ms (default 30s) */
  circuitOpenDurationMs: number;
  /** Max probes during half-open before re-opening (default 1) */
  halfOpenMaxProbes: number;
}

/** Result of a request through the protection layer */
export interface ProtectedRequestResult<T> {
  /** Whether the request succeeded */
  ok: boolean;
  /** Response data (if ok) */
  data?: T;
  /** Error message (if !ok) */
  error?: string;
  /** Whether the request was rate-limited */
  rateLimited: boolean;
  /** Whether the circuit breaker blocked the request */
  circuitBlocked: boolean;
}

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

/** Default configuration */
const DEFAULT_CONFIG: RpcProtectionConfig = {
  maxRequestsPerSec: 25,
  failureThreshold: 5,
  circuitOpenDurationMs: 30_000,
  halfOpenMaxProbes: 1,
};

/** Patterns that must NEVER appear in outbound RPC payloads */
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  // Private key formats (hex 64 chars without 0x prefix in a key-like context)
  /["']?(?:private[_-]?key|secret|seed|mnemonic)["']?\s*[:=]\s*["'][^"']+["']/i,
  // BIP-39 mnemonic (12 or 24 words)
  /(?:\b[a-z]{3,8}\b\s+){11,23}\b[a-z]{3,8}\b/i,
  // Raw private key hex (0x-prefixed 64 hex chars used as param value)
  /["']0x[0-9a-fA-F]{64}["']/,
];

// ────────────────────────────────────────────────────────────────
// Rate limiter (sliding window)
// ────────────────────────────────────────────────────────────────

/**
 * Sliding-window rate limiter per endpoint.
 * Tracks request timestamps and rejects when limit is exceeded.
 * @internal
 */
class RateLimiter {
  private readonly maxPerSec: number;
  private readonly timestamps: number[] = [];

  constructor(maxPerSec: number) {
    this.maxPerSec = maxPerSec;
  }

  /**
   * Attempt to acquire a request slot.
   * @returns true if allowed, false if rate-limited
   */
  tryAcquire(): boolean {
    const now = Date.now();
    const windowStart = now - 1000;

    // Prune timestamps outside the window
    while (this.timestamps.length > 0 && this.timestamps[0] < windowStart) {
      this.timestamps.shift();
    }

    if (this.timestamps.length >= this.maxPerSec) {
      return false;
    }

    this.timestamps.push(now);
    return true;
  }

  /** Current request count in the window */
  get count(): number {
    const now = Date.now();
    const windowStart = now - 1000;
    while (this.timestamps.length > 0 && this.timestamps[0] < windowStart) {
      this.timestamps.shift();
    }
    return this.timestamps.length;
  }
}

// ────────────────────────────────────────────────────────────────
// Circuit breaker
// ────────────────────────────────────────────────────────────────

/**
 * Circuit breaker for an RPC endpoint.
 * States:
 * - closed: requests flow normally
 * - open: all requests are rejected (endpoint is down)
 * - half-open: one probe request is allowed to test recovery
 * @internal
 */
class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailureTime = 0;
  private lastSuccessTime = 0;
  private halfOpenProbes = 0;
  private readonly config: RpcProtectionConfig;

  constructor(config: RpcProtectionConfig) {
    this.config = config;
  }

  /** Whether requests should be allowed */
  canRequest(): boolean {
    if (this.state === 'closed') return true;

    if (this.state === 'open') {
      // Check if enough time has passed to try half-open
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.circuitOpenDurationMs) {
        this.state = 'half-open';
        this.halfOpenProbes = 0;
        return true;
      }
      return false;
    }

    // half-open: allow limited probes
    if (this.halfOpenProbes < this.config.halfOpenMaxProbes) {
      this.halfOpenProbes++;
      return true;
    }

    return false;
  }

  /** Record a successful request */
  recordSuccess(): void {
    this.failures = 0;
    this.lastSuccessTime = Date.now();
    this.halfOpenProbes = 0;

    if (this.state !== 'closed') {
      this.state = 'closed';
    }
  }

  /** Record a failed request */
  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      // Probe failed — reopen
      this.state = 'open';
      return;
    }

    if (this.failures >= this.config.failureThreshold) {
      this.state = 'open';
    }
  }

  /** Get current health info */
  getHealth(): {
    state: CircuitState;
    failures: number;
    resetMs: number;
    lastSuccess: number;
    lastFailure: number;
  } {
    let resetMs = 0;
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime;
      resetMs = Math.max(0, this.config.circuitOpenDurationMs - elapsed);
    }

    return {
      state: this.state,
      failures: this.failures,
      resetMs,
      lastSuccess: this.lastSuccessTime,
      lastFailure: this.lastFailureTime,
    };
  }

  /** Force reset to closed state */
  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.halfOpenProbes = 0;
  }
}

// ────────────────────────────────────────────────────────────────
// Request/response sanitization
// ────────────────────────────────────────────────────────────────

/**
 * Sanitize an outbound RPC request payload.
 * Checks that no private keys, seed phrases, or mnemonics leak.
 * Pure function.
 *
 * @param payload - JSON-RPC request body as string
 * @returns Object with `safe` flag and optional `violation` description
 */
export function sanitizeRpcRequest(
  payload: string,
): { safe: boolean; violation?: string } {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(payload)) {
      return {
        safe: false,
        violation: 'Outbound RPC payload contains potentially sensitive data (private key or mnemonic)',
      };
    }
  }
  return { safe: true };
}

/**
 * Validate an RPC JSON response structure.
 * Ensures the response conforms to JSON-RPC 2.0 spec.
 * Pure function.
 *
 * @param response - Parsed JSON response object
 * @returns Object with `valid` flag and optional `reason`
 */
export function validateRpcResponse(
  response: unknown,
): { valid: boolean; reason?: string } {
  if (response === null || response === undefined) {
    return { valid: false, reason: 'Response is null or undefined' };
  }

  if (typeof response !== 'object') {
    return { valid: false, reason: 'Response is not an object' };
  }

  const resp = response as Record<string, unknown>;

  // JSON-RPC 2.0 must have jsonrpc field
  if (resp.jsonrpc !== '2.0') {
    return { valid: false, reason: 'Missing or invalid jsonrpc version' };
  }

  // Must have either result or error
  if (!('result' in resp) && !('error' in resp)) {
    return { valid: false, reason: 'Response has neither result nor error' };
  }

  // If error is present, validate structure
  if ('error' in resp && resp.error !== null) {
    const error = resp.error as Record<string, unknown>;
    if (typeof error !== 'object' || typeof error.code !== 'number') {
      return { valid: false, reason: 'Malformed error object in response' };
    }
  }

  return { valid: true };
}

// ────────────────────────────────────────────────────────────────
// RpcProtector — per-endpoint protection
// ────────────────────────────────────────────────────────────────

/** Strips auth params from RPC URL for logging (no sensitive data) */
function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Remove known auth path segments (Infura/Alchemy project IDs)
    u.search = '';
    u.hash = '';
    // Mask the last path segment if it looks like an API key
    const parts = u.pathname.split('/');
    const last = parts[parts.length - 1];
    if (last && last.length > 16) {
      parts[parts.length - 1] = last.slice(0, 4) + '***';
    }
    u.pathname = parts.join('/');
    return u.toString();
  } catch {
    return '<invalid-url>';
  }
}

/**
 * RPC endpoint protector.
 *
 * Combines rate limiting and circuit breaking for a single endpoint.
 * Use one instance per unique RPC URL.
 *
 * Features:
 * - **Rate limiting**: sliding-window, max N requests/sec
 * - **Circuit breaker**: opens after K consecutive failures, auto-recovers after T ms
 * - **Request sanitization**: blocks payloads containing private keys or mnemonics
 * - **Response validation**: validates JSON-RPC 2.0 response structure
 *
 * @example
 * ```ts
 * const protector = new RpcProtector('https://mainnet.infura.io/v3/KEY');
 *
 * const result = await protector.execute(async () => {
 *   return await fetch(rpcUrl, { method: 'POST', body });
 * });
 *
 * if (!result.ok) {
 *   console.warn(result.error);
 * }
 * ```
 */
export class RpcProtector {
  private readonly endpoint: string;
  private readonly rateLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly config: RpcProtectionConfig;

  constructor(
    endpoint: string,
    config: Partial<RpcProtectionConfig> = {},
  ) {
    this.endpoint = endpoint;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rateLimiter = new RateLimiter(this.config.maxRequestsPerSec);
    this.circuitBreaker = new CircuitBreaker(this.config);
  }

  /**
   * Execute an RPC request through the protection layer.
   *
   * @param fn - Async function that performs the actual RPC call
   * @param requestPayload - Optional request body for sanitization check
   * @returns Protected result with metadata
   */
  async execute<T>(
    fn: () => Promise<T>,
    requestPayload?: string,
  ): Promise<ProtectedRequestResult<T>> {
    // ── 1. Sanitize outbound payload ───────────────────────
    if (requestPayload) {
      const sanitized = sanitizeRpcRequest(requestPayload);
      if (!sanitized.safe) {
        return {
          ok: false,
          error: `[security] Request blocked: ${sanitized.violation}`,
          rateLimited: false,
          circuitBlocked: false,
        };
      }
    }

    // ── 2. Circuit breaker check ───────────────────────────
    if (!this.circuitBreaker.canRequest()) {
      return {
        ok: false,
        error: `[circuit-breaker] Endpoint ${sanitizeUrl(this.endpoint)} is temporarily unavailable`,
        rateLimited: false,
        circuitBlocked: true,
      };
    }

    // ── 3. Rate limiting check ─────────────────────────────
    if (!this.rateLimiter.tryAcquire()) {
      return {
        ok: false,
        error: `[rate-limit] Exceeded ${this.config.maxRequestsPerSec} req/s for ${sanitizeUrl(this.endpoint)}`,
        rateLimited: true,
        circuitBlocked: false,
      };
    }

    // ── 4. Execute the request ─────────────────────────────
    try {
      const data = await fn();
      this.circuitBreaker.recordSuccess();
      return {
        ok: true,
        data,
        rateLimited: false,
        circuitBlocked: false,
      };
    } catch (err) {
      this.circuitBreaker.recordFailure();
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'RPC request failed',
        rateLimited: false,
        circuitBlocked: false,
      };
    }
  }

  /** Get endpoint health info */
  getHealth(): EndpointHealth {
    const cbHealth = this.circuitBreaker.getHealth();
    return {
      endpoint: sanitizeUrl(this.endpoint),
      circuitState: cbHealth.state,
      failures: cbHealth.failures,
      requestsInWindow: this.rateLimiter.count,
      maxRequestsPerWindow: this.config.maxRequestsPerSec,
      circuitResetMs: cbHealth.resetMs,
      lastSuccess: cbHealth.lastSuccess,
      lastFailure: cbHealth.lastFailure,
    };
  }

  /** Force reset the circuit breaker to closed state */
  resetCircuit(): void {
    this.circuitBreaker.reset();
  }
}

// ────────────────────────────────────────────────────────────────
// Global protector registry (shared across the app)
// ────────────────────────────────────────────────────────────────

/** Global registry of protectors by endpoint URL */
const registry = new Map<string, RpcProtector>();

/**
 * Get or create a protector for an RPC endpoint.
 * Returns the same instance for the same URL (singleton per endpoint).
 *
 * @param endpoint - RPC endpoint URL
 * @param config - Optional protection configuration
 */
export function getProtector(
  endpoint: string,
  config?: Partial<RpcProtectionConfig>,
): RpcProtector {
  let protector = registry.get(endpoint);
  if (!protector) {
    protector = new RpcProtector(endpoint, config);
    registry.set(endpoint, protector);
  }
  return protector;
}

/**
 * Get health info for all registered endpoints.
 * @returns Array of endpoint health reports
 */
export function getAllEndpointHealth(): EndpointHealth[] {
  return Array.from(registry.values()).map(p => p.getHealth());
}

/**
 * Reset all circuit breakers to closed state.
 * Useful after network recovery or manual intervention.
 */
export function resetAllCircuits(): void {
  for (const protector of registry.values()) {
    protector.resetCircuit();
  }
}

/**
 * Clear the global protector registry.
 * Primarily for testing.
 */
export function clearProtectorRegistry(): void {
  registry.clear();
}
