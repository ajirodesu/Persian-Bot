/**
 * Shared LRU Cache — single bounded in-memory store for all repo caching layers.
 *
 * 2000-entry LRU eviction; 5-minute TTL fallback (repos explicitly invalidate on write).
 * Null-value caching: NULL_SENTINEL distinguishes cached null from a cache miss (undefined),
 * since lru-cache v11 rejects undefined but accepts any other value.
 */
import { LRUCache } from 'lru-cache';

const NULL_SENTINEL: unique symbol = Symbol('lru:null');

const cache = new LRUCache<string, NonNullable<unknown>>({
  max: 2000,
  ttl: 1000 * 60 * 5,
});

export const lruCache = {
  get<T>(key: string): T | undefined {
    const raw = cache.get(key) as unknown;
    if (raw === undefined) return undefined;
    if (raw === NULL_SENTINEL) return null as T;
    return raw as T;
  },

  set(key: string, value: unknown, ttlMs?: number): void {
    if (value === undefined) return; // lru-cache v11 throws for undefined
    cache.set(
      key,
      value === null ? NULL_SENTINEL : (value as NonNullable<unknown>),
      ttlMs !== undefined ? { ttl: ttlMs } : undefined,
    );
  },

  del(key: string): void {
    cache.delete(key);
  },

  /** Bulk-invalidate all keys sharing a common prefix. */
  delByPrefix(prefix: string): void {
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) cache.delete(key);
    }
  },

  /**
   * Bulk-invalidate matching any of the given prefixes in a single iteration.
   * More efficient than multiple sequential delByPrefix() calls (O(n) vs O(n×p)).
   */
  delByPrefixes(prefixes: string[]): void {
    for (const key of cache.keys()) {
      if (prefixes.some((p) => key.startsWith(p))) cache.delete(key);
    }
  },

  /** Evicts every entry — used for full database reset operations. */
  clear(): void {
    cache.clear();
  },
};
