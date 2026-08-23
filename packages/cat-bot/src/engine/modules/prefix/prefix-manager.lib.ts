/**
 * Prefix Manager — Dynamic Prefix Synchronization
 *
 * In-memory, centralized store for active session prefixes. Allows the web dashboard
 * to instantly update a running bot's prefix without requiring a full process restart
 * or exposing database fetches to the hot event-dispatch path.
 */

import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module

// Both thread maps grow one entry per thread the bot ever sees. Threads are
// effectively unbounded over a long-lived process, so they are capped: past
// the cap the oldest entries are evicted (Map preserves insertion order), and
// a checked-flag eviction simply costs one extra DB read for that thread the
// next time it is seen — correctness is never affected.
const THREAD_MAP_MAX = 10_000;

class PrefixManager {
  // Key format: `${userId}:${platform}:${sessionId}` (e.g. "cuid123:discord:uuid456")
  private prefixes = new Map<string, string>();
  // Thread-level prefix overrides — keyed by platform threadId (Discord channelId, FB threadId, etc.).
  // A thread entry wins over the session prefix so individual groups can customise the trigger character.
  private threadPrefixes = new Map<string, string>();
  // Negative cache: thread IDs whose custom-prefix state is already known (either loaded from
  // the DB at boot, or set/cleared in-process). Lets restoreThreadPrefix skip the DB lookup
  // entirely for the common case (threads WITHOUT a custom prefix) — that lookup previously
  // ran on every single message, costing two DB round-trips on the hot path.
  private threadPrefixesChecked = new Map<string, true>();

  /** Bounded insert for the thread-keyed stores (evicts oldest past the cap). */
  private boundedThreadSet<K, V>(map: Map<K, V>, key: K, value: V): void {
    if (!map.has(key) && map.size >= THREAD_MAP_MAX) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
    map.set(key, value);
  }

  private getKey(userId: string, platform: string, sessionId: string): string {
    return `${userId}:${platform}:${sessionId}`;
  }

  /**
   * Sets or updates the prefix for a specific bot session.
   */
  setPrefix(
    userId: string,
    platform: string,
    sessionId: string,
    prefix: string,
  ): void {
    const key = this.getKey(userId, platform, sessionId);
    this.prefixes.set(key, prefix);
    logger.debug(
      `[prefix-manager] Prefix for ${key} dynamically synced to "${prefix}"`,
    );
  }

  /**
   * Retrieves the live prefix for a session. Defaults to '/' if absent.
   */
  getPrefix(userId: string, platform: string, sessionId: string): string {
    const key = this.getKey(userId, platform, sessionId);
    return this.prefixes.get(key) ?? '/';
  }

  /**
   * Stores a thread-level prefix override, used by /prefix command to customise
   * the trigger character for a specific group without affecting other threads.
   */
  setThreadPrefix(threadId: string, prefix: string): void {
    this.boundedThreadSet(this.threadPrefixes, threadId, prefix);
    // The authoritative state is now known in-process — no DB re-check needed.
    this.boundedThreadSet(this.threadPrefixesChecked, threadId, true);
    logger.debug(
      `[prefix-manager] Thread prefix for ${threadId} set to "${prefix}"`,
    );
  }

  /**
   * Returns the thread-level prefix override, or undefined when no override is registered.
   * Callers must fall back to getPrefix() when this returns undefined — this is intentional
   * so the system prefix remains the default without explicitly storing it per-thread.
   */
  getThreadPrefix(threadId: string): string | undefined {
    return this.threadPrefixes.get(threadId);
  }

  /**
   * Removes a thread-level prefix override (/prefix reset).
   * After clearing, getThreadPrefix() returns undefined and the session default takes over.
   */
  clearThreadPrefix(threadId: string): void {
    this.threadPrefixes.delete(threadId);
    // Same rationale as setThreadPrefix: the cleared state is authoritative.
    this.boundedThreadSet(this.threadPrefixesChecked, threadId, true);
    logger.debug(
      `[prefix-manager] Thread prefix cleared for ${threadId} — reverting to session default`,
    );
  }

  /** True when the thread's custom-prefix state has already been resolved this process. */
  isThreadPrefixChecked(threadId: string): boolean {
    return this.threadPrefixesChecked.has(threadId);
  }

  /** Records that the thread's custom-prefix state was just resolved (found or not). */
  markThreadPrefixChecked(threadId: string): void {
    this.boundedThreadSet(this.threadPrefixesChecked, threadId, true);
  }

  /**
   * Evicts all session-level prefix entries for a userId.
   * Called on account ban so memory is not leaked by stopped sessions.
   * Thread prefixes are keyed by platform threadId (userId is not encoded), so they
   * are intentionally left intact — they will be overwritten on the next message event.
   */
  clearAllByUserId(userId: string): void {
    for (const key of [...this.prefixes.keys()]) {
      if (key.startsWith(`${userId}:`)) this.prefixes.delete(key);
    }
  }

  /**
   * Evicts every session-level AND thread-level prefix entry, regardless of owner.
   * Called as part of a full database reset — every session/thread not belonging
   * to the admin performing the reset no longer exists, and the admin's own
   * surviving entries are harmlessly repopulated from the DB on next use.
   */
  clearAll(): void {
    this.prefixes.clear();
    this.threadPrefixes.clear();
    this.threadPrefixesChecked.clear();
  }
}

export const prefixManager = new PrefixManager();
