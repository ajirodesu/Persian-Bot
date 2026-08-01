/**
 * kick-registry.lib.ts — Transient Kick Registry
 *
 * Bridges the gap between kick.ts / badwords.ts removing a user via thread.removeUser()
 * and the log:unsubscribe event it produces. Without this registry, leave.ts would send
 * a redundant "A member has been removed" notice after the kick command already notified.
 *
 * Usage:
 *   1. kick.ts / badwords.ts → kickRegistry.register(threadID, uid) before removeUser()
 *   2. on-event.middleware.ts → kickRegistry.consume(threadID, uid) in log:unsubscribe guard
 *      — returns true (suppress leave.ts) and clears the entry
 *
 * Each entry self-expires after TTL_MS (30 s) in case log:unsubscribe never arrives.
 */

const TTL_MS = 30_000;

type ThreadRegistry = Map<string, ReturnType<typeof setTimeout>>;
const registry = new Map<string, ThreadRegistry>();

export const kickRegistry = {
  /**
   * Register a uid as "just removed by bot command".
   * Registering the same uid twice resets the expiry timer.
   */
  register(threadID: string, uid: string): void {
    if (!registry.has(threadID)) registry.set(threadID, new Map());
    const threadMap = registry.get(threadID)!;
    const existing = threadMap.get(uid);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      threadMap.delete(uid);
      if (threadMap.size === 0) registry.delete(threadID);
    }, TTL_MS);
    threadMap.set(uid, timer);
  },

  /**
   * Returns true if uid was registered (bot-driven removal), consuming the entry.
   * Returns false for voluntary departures or if the entry was never registered.
   */
  consume(threadID: string, uid: string): boolean {
    const threadMap = registry.get(threadID);
    if (!threadMap) return false;
    const timer = threadMap.get(uid);
    if (timer === undefined) return false;
    clearTimeout(timer);
    threadMap.delete(uid);
    if (threadMap.size === 0) registry.delete(threadID);
    return true;
  },
} as const;
