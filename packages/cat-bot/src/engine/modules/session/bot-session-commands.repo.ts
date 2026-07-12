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
 *   - upsertSessionCommands → re-fetches and WARMS the session's command-list cache
 *     (rather than just clearing it). This runs once per session during boot's
 *     syncCommandsAndEvents(), before any platform transport starts. Merely deleting
 *     the entry here left it cold, so the very first command a user sent after a
 *     restart paid a full DB round-trip inside isCommandEnabled() before the command
 *     body even ran — inflating that command's measured latency (visible in ping/uptime,
 *     since their reported "latency" is pipeline time captured from event receipt, not
 *     network round-trip). Priming it at boot moves that DB cost off the user-facing path.
 *
 * TTL: entries in this file are written with an explicit `ttl: 0` (= no expiry), which
 * overrides the shared cache's 5-minute default just for these keys. That default exists
 * as a safety net for repos that DON'T write through on every mutation; this one does
 * (see above), so a time-based expiry here only hurt — a session idle for more than 5
 * minutes would silently go cold and pay the same DB round-trip on its next command,
 * which is exactly the "works after restart, breaks again after being idle" pattern.
 * Correctness still holds because every mutation path explicitly updates or clears the
 * entry; nothing depends on the TTL to eventually pick up stale data.
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
  // ttl: 0 = never expire this entry on its own — see file header. Without this, a
  // session idle for 5+ minutes would silently evict here and pay a fresh DB
  // round-trip on its very next command.
  lruCache.set(key, result, 0);
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
  const key = commandsListKey(userId, platform, sessionId);
  try {
    // Re-read the merged row set (existing isEnable=false overrides survive the upsert
    // unchanged, new rows default enabled) and cache it directly — a warm cache after
    // boot instead of a cold one waiting to be filled by the first real user command.
    const rows = await _findSessionCommands(userId, platform, sessionId);
    lruCache.set(key, rows, 0); // ttl: 0 = never expire — see file header
  } catch {
    // Fail-open: if the warm-up read fails for any reason, fall back to the previous
    // behaviour (invalidate only) so isCommandEnabled() still self-heals on next call.
    lruCache.del(key);
  }
}
