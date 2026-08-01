/**
 * CooldownStore — In-memory per-user command rate-limit tracker.
 * In-memory (not persistent): a bot restart resetting active windows is acceptable UX.
 * Synchronous reads keep the hot path (every command invocation) latency-free.
 */

export interface CooldownEntry {
  /** Unix ms timestamp when this cooldown window expires. */
  expiry: number;
  /** True after the first "please wait" notice is sent; prevents flooding. */
  notified: boolean;
}

class CooldownStore {
  readonly #store = new Map<string, CooldownEntry>();

  /** Returns the active entry (not yet expired), or null if free to proceed. */
  check(key: string, now: number): CooldownEntry | null {
    const entry = this.#store.get(key);
    if (entry !== undefined && now < entry.expiry) return entry;
    return null;
  }

  /** Registers a fresh cooldown window, overwriting any existing entry. */
  record(key: string, now: number, durationMs: number): void {
    this.#store.set(key, { expiry: now + durationMs, notified: false });
  }

  /** Marks the active entry as notified; no-op if already expired. */
  markNotified(key: string): void {
    const entry = this.#store.get(key);
    if (entry !== undefined) entry.notified = true;
  }

  /**
   * Lazy eviction: prunes expired entries when store exceeds `threshold`.
   * Called at the top of enforceCooldown to avoid a background timer dependency.
   */
  pruneIfNeeded(now: number, threshold = 10_000): void {
    if (this.#store.size <= threshold) return;
    for (const [k, v] of this.#store) {
      if (now > v.expiry) this.#store.delete(k);
    }
  }
}

/** Singleton shared across all middleware invocations. */
export const cooldownStore = new CooldownStore();

// Background sweep every 5 minutes. Cooldowns use fixed TTL — must NOT slide.
const _cooldownCleanup = setInterval(
  () => { cooldownStore.pruneIfNeeded(Date.now(), 0); },
  5 * 60 * 1000,
);
(_cooldownCleanup as NodeJS.Timeout).unref();
