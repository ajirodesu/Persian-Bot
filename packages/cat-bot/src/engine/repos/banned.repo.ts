/**
 * Banned Repo — LRU cache layer over the database adapter.
 *
 * isUserBanned / isThreadBanned are called on every incoming message before command dispatch.
 * Caching them eliminates a DB roundtrip on the hot path while maintaining correctness:
 * ban/unban mutations write the known new boolean directly into cache rather than deleting
 * the key, so the next isUserBanned read sees the authoritative value from memory instead
 * of re-querying the DB.
 *
 * All entries use ttl: 0 (never expire on their own). This is safe specifically because
 * ban/unban state has exactly one mutation path — banUser/unbanUser/banThread/unbanThread
 * below — with no other process or dashboard writing to it directly; every write updates
 * the cache in the same call. (Contrast with session.repo.ts / system-admin.repo.ts, which
 * deliberately keep a time-based TTL because their data can also change through paths this
 * process doesn't observe.) Without ttl: 0, a session idle for 5+ minutes would silently
 * evict here and pay a fresh DB round-trip on the very next command from every user.
 */
import {
  banUser as _banUser,
  unbanUser as _unbanUser,
  isUserBanned as _isUserBanned,
  banThread as _banThread,
  unbanThread as _unbanThread,
  isThreadBanned as _isThreadBanned,
} from 'database';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

// ── Cache key builders ─────────────────────────────────────────────────────────
// Colon-separated segments make prefix scanning unambiguous and human-readable in
// debug tooling. The `banned:` namespace prevents collisions with other repo keys.

const userBanKey = (
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): string => `${userId}:${platform}:${sessionId}:banned:user:${botUserId}`;

const threadBanKey = (
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): string => `${userId}:${platform}:${sessionId}:banned:thread:${botThreadId}`;

// ── User Bans ─────────────────────────────────────────────────────────────────

export async function banUser(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
  reason?: string,
): Promise<void> {
  await _banUser(userId, platform, sessionId, botUserId, reason);
  // Write true immediately (ttl: 0 = never expire on its own) so the next
  // isUserBanned call always sees the authoritative value from memory rather
  // than a stale pre-ban read or a cold DB hit after an idle gap.
  lruCache.set(userBanKey(userId, platform, sessionId, botUserId), true, 0);
}

export async function unbanUser(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<void> {
  await _unbanUser(userId, platform, sessionId, botUserId);
  lruCache.set(userBanKey(userId, platform, sessionId, botUserId), false, 0);
}

export async function isUserBanned(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<boolean> {
  const key = userBanKey(userId, platform, sessionId, botUserId);
  const cached = lruCache.get<boolean>(key);
  if (cached !== undefined) return cached;
  const result = await _isUserBanned(userId, platform, sessionId, botUserId);
  // ttl: 0 — checked on every command via enforceNotBanned; fully self-contained
  // (banUser/unbanUser above are the only writers), so no time-based expiry needed.
  lruCache.set(key, result, 0);
  return result;
}

// ── Thread Bans ───────────────────────────────────────────────────────────────

export async function banThread(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
  reason?: string,
): Promise<void> {
  await _banThread(userId, platform, sessionId, botThreadId, reason);
  lruCache.set(threadBanKey(userId, platform, sessionId, botThreadId), true, 0);
}

export async function unbanThread(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<void> {
  await _unbanThread(userId, platform, sessionId, botThreadId);
  lruCache.set(threadBanKey(userId, platform, sessionId, botThreadId), false, 0);
}

export async function isThreadBanned(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<boolean> {
  const key = threadBanKey(userId, platform, sessionId, botThreadId);
  const cached = lruCache.get<boolean>(key);
  if (cached !== undefined) return cached;
  const result = await _isThreadBanned(
    userId,
    platform,
    sessionId,
    botThreadId,
  );
  // ttl: 0 — same reasoning as isUserBanned above.
  lruCache.set(key, result, 0);
  return result;
}
