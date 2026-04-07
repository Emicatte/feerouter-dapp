/**
 * src/lib/price/cache.ts — Price caching layer
 *
 * In-memory LRU cache with TTL, stale-while-revalidate pattern,
 * and localStorage persistence for top-20 tokens on cold start.
 */

import type { PriceMap, TokenPrice } from './oracle';

/** Cache entry with expiry and staleness threshold */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  /** Entry is stale after this time but still usable while revalidating */
  staleAt: number;
}

/** Default cache TTL in milliseconds (30 seconds) */
const DEFAULT_TTL_MS = 30_000;

/** Stale-while-revalidate window beyond TTL (5 minutes) */
const STALE_WINDOW_MS = 5 * 60 * 1000;

/** Maximum cache entries (LRU eviction beyond this) */
const MAX_CACHE_SIZE = 500;

/** Number of top prices to persist in localStorage */
const PERSIST_TOP_N = 20;

/** localStorage key for persisted prices */
const STORAGE_KEY = 'wc-price-cache';

// ────────────────────────────────────────────────────────────────
// LRU Cache implementation
// ────────────────────────────────────────────────────────────────

/** Access-order tracking for LRU eviction */
const accessOrder: string[] = [];

/** In-memory price cache */
const priceCache = new Map<string, CacheEntry<TokenPrice>>();

/**
 * Touch a key to mark it as recently used (LRU tracking).
 * @internal
 */
function touchKey(key: string): void {
  const idx = accessOrder.indexOf(key);
  if (idx !== -1) accessOrder.splice(idx, 1);
  accessOrder.push(key);
}

/**
 * Evict least-recently-used entries if cache exceeds MAX_CACHE_SIZE.
 * @internal
 */
function evictIfNeeded(): void {
  while (priceCache.size > MAX_CACHE_SIZE && accessOrder.length > 0) {
    const oldest = accessOrder.shift();
    if (oldest) priceCache.delete(oldest);
  }
}

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Get a cached price, or null if expired/missing.
 * Returns stale entries during the stale-while-revalidate window.
 *
 * @param id - Cache key (CoinGecko ID or chain:address)
 * @returns The cached price, or null if unavailable
 */
export function getCachedPrice(id: string): TokenPrice | null {
  const entry = priceCache.get(id);
  if (!entry) return null;

  const now = Date.now();

  // Completely expired (beyond stale window)
  if (now > entry.expiresAt + STALE_WINDOW_MS) {
    priceCache.delete(id);
    const idx = accessOrder.indexOf(id);
    if (idx !== -1) accessOrder.splice(idx, 1);
    return null;
  }

  touchKey(id);
  return entry.value;
}

/**
 * Check whether a cached entry is stale (but still usable).
 * Use this to trigger background revalidation.
 *
 * @param id - Cache key
 * @returns true if entry exists but is past its stale threshold
 */
export function isCacheStale(id: string): boolean {
  const entry = priceCache.get(id);
  if (!entry) return true;
  return Date.now() > entry.staleAt;
}

/**
 * Store prices in the cache with LRU eviction.
 *
 * @param prices - Price map to cache
 * @param ttlMs - TTL in milliseconds (default 30s)
 */
export function cachePrices(prices: PriceMap, ttlMs: number = DEFAULT_TTL_MS): void {
  const now = Date.now();
  const expiresAt = now + ttlMs;
  const staleAt = now + ttlMs; // stale = expired for fresh entries

  for (const [id, price] of Object.entries(prices)) {
    priceCache.set(id, { value: price, expiresAt, staleAt });
    touchKey(id);
  }

  evictIfNeeded();
}

/**
 * Store a single price in the cache.
 *
 * @param id - Cache key
 * @param price - Price data
 * @param ttlMs - TTL in milliseconds
 */
export function cachePrice(id: string, price: TokenPrice, ttlMs: number = DEFAULT_TTL_MS): void {
  const now = Date.now();
  priceCache.set(id, {
    value: price,
    expiresAt: now + ttlMs,
    staleAt: now + ttlMs,
  });
  touchKey(id);
  evictIfNeeded();
}

/**
 * Clear the entire price cache.
 */
export function clearPriceCache(): void {
  priceCache.clear();
  accessOrder.length = 0;
}

/**
 * Get the number of entries in the cache.
 */
export function priceCacheSize(): number {
  return priceCache.size;
}

/**
 * Get all cached prices as a PriceMap (non-expired entries only).
 */
export function getAllCachedPrices(): PriceMap {
  const now = Date.now();
  const result: PriceMap = {};
  for (const [id, entry] of priceCache) {
    if (now <= entry.expiresAt + STALE_WINDOW_MS) {
      result[id] = entry.value;
    }
  }
  return result;
}

// ────────────────────────────────────────────────────────────────
// localStorage persistence (top-20 for cold start)
// ────────────────────────────────────────────────────────────────

/** Serializable format for localStorage */
interface PersistedPriceEntry {
  id: string;
  usd: number;
  eur: number;
  timestamp: number;
}

/**
 * Persist the top N prices (by USD value relevance) to localStorage.
 * Called periodically by the price updater.
 */
export function persistTopPrices(): void {
  try {
    const entries: PersistedPriceEntry[] = [];
    for (const [id, entry] of priceCache) {
      entries.push({
        id,
        usd: entry.value.usd,
        eur: entry.value.eur,
        timestamp: entry.value.lastUpdated,
      });
    }

    // Sort by most recently updated, take top N
    entries.sort((a, b) => b.timestamp - a.timestamp);
    const top = entries.slice(0, PERSIST_TOP_N);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(top));
  } catch { /* SSR or storage blocked */ }
}

/**
 * Load persisted prices from localStorage into cache.
 * Entries are loaded with a stale marker so they trigger revalidation.
 * Max age: 5 minutes (entries older than that are discarded).
 */
export function loadPersistedPrices(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const entries: PersistedPriceEntry[] = JSON.parse(raw);
    const now = Date.now();
    const maxAge = STALE_WINDOW_MS; // 5 min

    for (const entry of entries) {
      if (now - entry.timestamp > maxAge) continue;

      // Load as stale so revalidation is triggered
      priceCache.set(entry.id, {
        value: {
          usd: entry.usd,
          eur: entry.eur,
          lastUpdated: entry.timestamp,
        },
        expiresAt: entry.timestamp + DEFAULT_TTL_MS, // Already expired
        staleAt: entry.timestamp, // Already stale
      });
      touchKey(entry.id);
    }
  } catch { /* SSR or storage blocked */ }
}
