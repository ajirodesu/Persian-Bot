/**
 * Bot Session Commands Repo — LRU cache layer over the database adapter.
 *
 * isCommandEnabled() runs on EVERY command invocation across every platform (see
 * message.handler.ts) — it was previously an uncached passthrough straight to the
 * database adapter, meaning every single command a user typed paid a full DB
 * round-trip before the command body even started running. That round-trip is pure
 * added latency on top of the command's own work, directly inflating perceived bot
 * response time. The enabled/disabled flag also changes extremely rarely (only when
 * a bot admin toggles a command from the dashboard or chat), so it is an ideal
 * candidate for aggressive caching.
 *
 * WHY: Abstracted safely through database workspace so the caller stays agnostic to
 * which configured adapter (mongodb | neondb) is actually active.
 *
 * Invalidation strategy:
 *   - setCommandEnabled     → clears the session's command-list cache (isCommandEnabled
 *     and findSessionCommands both read from it, so one entry covers both).
 *   - upsertSessionCommands → clears the session's command-list cache (boot-time sync
 *     can add newly-discovered commands that must be visible immediately).
 */
import {
  upsertSessionCommands as _upsertSessionCommands,
  findSessionCommands as _findSessionCommands,
  setCommandEnabled as _setCommandEnabled,
  isCommandEnabled as _isCommandEnabled,
} from 'database';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

const commandsListKey = (
  userId: string,
  platform: string,
  sessionId: string,
): string => `${userId}:${platform}:${sessionId}:session:commands`;

// Mirrors the exact adapter return type (rather than a hand-rolled interface) so callers
// that spread/narrow the result (e.g. the dashboard commands-list controller) keep the same
// structural typing they had before caching was introduced.
type SessionCommandRows = Awaited<ReturnType<typeof _findSessionCommands>>;

async function findSessionCommandsCached(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<SessionCommandRows> {
  const key = commandsListKey(userId, platform, sessionId);
  const cached = lruCache.get<SessionCommandRows>(key);
  if (cached !== undefined) return cached;
  const result = await _findSessionCommands(userId, platform, sessionId);
  lruCache.set(key, result);
  return result;
}

export async function findSessionCommands(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<SessionCommandRows> {
  return findSessionCommandsCached(userId, platform, sessionId);
}

/**
 * Hot-path check — called on every command invocation. Delegates to the cached
 * session command list instead of issuing its own DB query, so a warm cache means
 * zero DB round-trips for the vast majority of messages.
 */
export async function isCommandEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  commandName: string,
): Promise<boolean> {
  try {
    const rows = await findSessionCommandsCached(userId, platform, sessionId);
    const row = rows.find(
      (r: { commandName: string; isEnable: boolean }) =>
        r.commandName === commandName,
    );
    // Fail-open when the command was never synced into the DB — matches the previous
    // adapter behaviour where an absent row defaulted to enabled.
    return row ? row.isEnable : true;
  } catch {
    // Fail-open on any cache/DB error so a transient failure never blocks command execution.
    return _isCommandEnabled(userId, platform, sessionId, commandName);
  }
}

export async function setCommandEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  commandName: string,
  isEnable: boolean,
): Promise<void> {
  await _setCommandEnabled(userId, platform, sessionId, commandName, isEnable);
  lruCache.del(commandsListKey(userId, platform, sessionId));
}

export async function upsertSessionCommands(
  userId: string,
  platform: string,
  sessionId: string,
  commandNames: string[],
): Promise<void> {
  await _upsertSessionCommands(userId, platform, sessionId, commandNames);
  lruCache.del(commandsListKey(userId, platform, sessionId));
}
