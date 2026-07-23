/**
 * CommandLimitStore — In-Memory Per-User Command Count Tracker
 *
 * Enforces a maximum number of commands a user may invoke within a single
 * rolling time window. This is the "per-message command limit" guard:
 *   - Regular users: max MAX_COMMANDS_PER_WINDOW within WINDOW_MS
 *   - System admins: exempt (checked upstream in enforceCommandLimit)
 *
 * Modelled after CooldownStore in lib/cooldown.lib.ts — in-memory Map with
 * lazy eviction — so it is a true leaf node with zero external imports.
 *
 * Intentionally in-memory:
 *   - Command-rate windows are short-lived; a bot restart resetting active
 *     windows is acceptable UX.
 *   - Synchronous reads keep the hot path latency-free.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum commands a non-admin user may invoke within one window. */
export const MAX_COMMANDS_PER_WINDOW = 5;

/** Rolling window duration in milliseconds (default: 60 seconds). */
export const COMMAND_LIMIT_WINDOW_MS = 60_000;

// ── Entry shape ───────────────────────────────────────────────────────────────

export interface CommandLimitEntry {
  /** Unix ms timestamp when this window expires and the counter resets. */
  windowExpiry: number;
  /** Number of commands invoked within the current window. */
  count: number;
  /**
   * Flipped to true after the first "limit reached" reply is sent within a window.
   * Prevents flooding the chat when a user keeps retrying after being told to wait.
   */
  notified: boolean;
}

// ── Store ─────────────────────────────────────────────────────────────────────

class CommandLimitStore {
  readonly #store = new Map<string, CommandLimitEntry>();

  /**
   * Records one command invocation for a user key within a rolling window.
   *
   * - If no entry exists (or window has expired), starts a fresh window with count = 1.
   * - If within an active window, increments the counter.
   *
   * Returns the updated entry so the caller can check the count in one call.
   */
  record(key: string, now: number): CommandLimitEntry {
    const existing = this.#store.get(key);
    if (existing === undefined || now >= existing.windowExpiry) {
      // Fresh window — first command in this period.
      const entry: CommandLimitEntry = {
        windowExpiry: now + COMMAND_LIMIT_WINDOW_MS,
        count: 1,
        notified: false,
      };
      this.#store.set(key, entry);
      return entry;
    }
    // Active window — increment.
    existing.count += 1;
    return existing;
  }

  /**
   * Marks the active window entry as notified so subsequent blocked invocations
   * within the same window are silently dropped — one notice per window maximum.
   * No-op when the key is absent (window already expired).
   */
  markNotified(key: string): void {
    const entry = this.#store.get(key);
    if (entry !== undefined) entry.notified = true;
  }

  /**
   * Lazy eviction: prunes expired entries when the store exceeds `threshold`.
   * Called at the top of enforceCommandLimit to keep memory bounded without a
   * background timer, mirroring CooldownStore.pruneIfNeeded.
   */
  pruneIfNeeded(now: number, threshold = 10_000): void {
    if (this.#store.size <= threshold) return;
    for (const [k, v] of this.#store) {
      if (now >= v.windowExpiry) this.#store.delete(k);
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

/**
 * Singleton — all middleware invocations share this instance so command counts
 * persist for the full process lifetime across concurrent requests.
 */
export const commandLimitStore = new CommandLimitStore();

// Background sweep every 5 minutes evicts expired windows that accumulated
// without a subsequent write to trigger the lazy threshold prune. Unref'd so
// this housekeeping timer cannot delay process exit after all sessions stop.
const _commandLimitCleanup = setInterval(
  () => {
    commandLimitStore.pruneIfNeeded(Date.now(), 0);
  },
  5 * 60 * 1000,
);
(_commandLimitCleanup as NodeJS.Timeout).unref();
