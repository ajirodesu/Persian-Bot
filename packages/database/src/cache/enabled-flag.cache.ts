/**
 * Enabled-Flag Cache
 *
 * WHY THIS EXISTS:
 * isCommandEnabled()/isEventEnabled() run on the hot path of EVERY message the
 * bot receives on every platform — message.handler.ts calls isCommandEnabled
 * right before dispatching any matched command, and the equivalent event check
 * runs for every non-message platform event. In the overwhelming majority of
 * invocations the answer is "yes, enabled" (an admin disabling a specific
 * command in a specific session is a rare, deliberate action), so paying a full
 * DB round-trip for that answer on every message is avoidable latency.
 *
 * This wraps the read with a short TTL cache and has the write path
 * (setCommandEnabled/setEventEnabled) update the cache immediately in the same
 * call — so an admin toggling a command takes effect on the very next message,
 * never waiting out the TTL, while normal traffic almost always hits memory
 * instead of the database.
 *
 * Deliberately process-local (no cross-instance invalidation): the existing
 * fail-open contract already tolerates brief staleness (a DB hiccup returns
 * "enabled"), and a few seconds of cache lag on a rarely-changed admin toggle
 * is an acceptable trade for removing a DB call from every message.
 */

const TTL_MS = 30_000;

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

function makeKey(
  userId: string,
  platform: string,
  sessionId: string,
  name: string,
): string {
  return `${userId}:${platform}:${sessionId}:${name}`;
}

function createEnabledCache() {
  const store = new Map<string, CacheEntry>();

  return {
    get(
      userId: string,
      platform: string,
      sessionId: string,
      name: string,
    ): boolean | undefined {
      const key = makeKey(userId, platform, sessionId, name);
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt < Date.now()) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(
      userId: string,
      platform: string,
      sessionId: string,
      name: string,
      value: boolean,
    ): void {
      store.set(makeKey(userId, platform, sessionId, name), {
        value,
        expiresAt: Date.now() + TTL_MS,
      });
    },
  };
}

export const commandEnabledCache = createEnabledCache();
export const eventEnabledCache = createEnabledCache();
