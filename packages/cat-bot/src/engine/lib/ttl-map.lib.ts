/**
 * TTLMap — Generic in-memory Map with sliding or fixed expiration and lazy eviction.
 *
 *   sliding: true  (default) — each get() resets the TTL window (active entries stay alive)
 *   sliding: false           — TTL fixed at write time; use for single-consumption payloads
 *
 * Eviction:
 *   1. Lazy on read — get() checks expiry and deletes before returning
 *   2. Threshold-triggered sweep — set() runs prune() when size hits pruneThreshold
 *   3. Background timer (opt-in via cleanupIntervalMs) — unref'd setInterval
 */

export class TTLMap<V> {
  readonly #store = new Map<string, { value: V; expiry: number }>();
  readonly #ttlMs: number;
  readonly #sliding: boolean;
  readonly #pruneThreshold: number;

  constructor(opts: {
    ttlMs: number;
    /** When true (default), a successful get() resets the expiry clock. */
    sliding?: boolean;
    /** Store size above which set() triggers a full sweep. Default 500. */
    pruneThreshold?: number;
    /** Milliseconds between background cleanup sweeps (unref'd). Omit for low-write stores. */
    cleanupIntervalMs?: number;
  }) {
    this.#ttlMs = opts.ttlMs;
    this.#sliding = opts.sliding ?? true;
    this.#pruneThreshold = opts.pruneThreshold ?? 500;

    if (opts.cleanupIntervalMs !== undefined) {
      const timer = setInterval(() => { this.prune(); }, opts.cleanupIntervalMs);
      (timer as NodeJS.Timeout).unref();
    }
  }

  /** Returns the value, or undefined when absent or expired. Lazily deletes expired entries. */
  get(key: string): V | undefined {
    const entry = this.#store.get(key);
    if (entry === undefined) return undefined;
    const now = Date.now();
    if (now >= entry.expiry) { this.#store.delete(key); return undefined; }
    if (this.#sliding) entry.expiry = now + this.#ttlMs;
    return entry.value;
  }

  /** Stores a value with a fresh TTL window. Triggers a sweep if over pruneThreshold. */
  set(key: string, value: V): void {
    if (this.#store.size >= this.#pruneThreshold) this.prune();
    this.#store.set(key, { value, expiry: Date.now() + this.#ttlMs });
  }

  /** Returns true when the key exists and its TTL has not elapsed. */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Immediately removes an entry regardless of remaining TTL. */
  delete(key: string): void {
    this.#store.delete(key);
  }

  /** Sweeps the entire store, removing all expired entries. */
  prune(): void {
    const now = Date.now();
    for (const [k, v] of this.#store) {
      if (now >= v.expiry) this.#store.delete(k);
    }
  }

  /** Raw entry count (may include not-yet-lazily-evicted expired entries). */
  get size(): number {
    return this.#store.size;
  }
}
