/**
 * Admin-Only State Cache
 *
 * Stores whether session-wide admin-only mode and per-thread adminbox mode are
 * enabled, using the shared LRU cache.  This allows enforceAdminOnly to skip ALL
 * async DB reads for Role.ANYONE commands when both modes are known to be off.
 *
 * Why a separate module instead of inline LRU calls in the middleware?
 *   - The invalidation functions must also be importable by the adminonly /
 *     onlyadminbox command handlers so they can clear stale flags immediately
 *     when the admin toggles a mode — preventing the TTL-based stale window
 *     from ever allowing a bypassed command.
 *   - A dedicated module makes the caching contract explicit and testable.
 *
 * Key design:
 *   - cached `false`   → admin-only confirmed off; enforceAdminOnly can skip
 *   - cached `true`    → admin-only on; full check required
 *   - `undefined`      → not yet seen; full check required (populates the flag)
 *
 * Invalidation:
 *   enforceAdminOnly calls set* after every settings read so the value is always
 *   current.  admin-only-mode.ts calls invalidate* immediately after a toggle so
 *   the NEXT command sees the updated state rather than waiting for TTL expiry.
 *
 * TTL: falls back to the shared LRU default (5 min) — acceptable because explicit
 * invalidation on every write is the primary correctness mechanism, and TTL is
 * only the safety-net fallback.
 */

import { lruCache } from '@/engine/lib/lru-cache.lib.js';

// ── Key builders ──────────────────────────────────────────────────────────────

/** LRU key for session-wide admin-only state, scoped to (userId, platform, sessionId). */
const sessKey = (u: string, p: string, s: string): string =>
  `adminonly:sess:${u}:${p}:${s}`;

/** LRU key for per-thread adminbox state, scoped to (userId, platform, sessionId, threadId). */
const threadKey = (u: string, p: string, s: string, t: string): string =>
  `adminonly:thread:${u}:${p}:${s}:${t}`;

// ── Session-wide admin-only ───────────────────────────────────────────────────

/**
 * Returns the cached session-wide admin-only enabled state.
 * `undefined` means not yet cached — caller must perform the full DB read.
 */
export function getCachedSessionAdminOnly(
  userId: string,
  platform: string,
  sessionId: string,
): boolean | undefined {
  return lruCache.get<boolean>(sessKey(userId, platform, sessionId));
}

/**
 * Stores the session-wide admin-only enabled state.
 * Called by enforceAdminOnly after every settings read, and by
 * admin-only-mode.ts immediately after toggling the mode on or off.
 */
export function setCachedSessionAdminOnly(
  userId: string,
  platform: string,
  sessionId: string,
  enabled: boolean,
): void {
  lruCache.set(sessKey(userId, platform, sessionId), enabled);
}

/**
 * Removes the session-wide admin-only flag from the LRU.
 * Call from admin-only-mode.ts when the setting is toggled so
 * the next enforceAdminOnly invocation reads the fresh value.
 */
export function invalidateSessionAdminOnly(
  userId: string,
  platform: string,
  sessionId: string,
): void {
  lruCache.del(sessKey(userId, platform, sessionId));
}

// ── Per-thread adminbox ───────────────────────────────────────────────────────

/**
 * Returns the cached per-thread adminbox enabled state.
 * `undefined` means not yet cached — caller must perform the full DB read.
 */
export function getCachedThreadAdminBox(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): boolean | undefined {
  return lruCache.get<boolean>(threadKey(userId, platform, sessionId, threadId));
}

/**
 * Stores the per-thread adminbox enabled state.
 * Called by enforceAdminOnly after every thread settings read, and by
 * admin-only-mode.ts immediately after toggling the mode on or off.
 */
export function setCachedThreadAdminBox(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
  enabled: boolean,
): void {
  lruCache.set(threadKey(userId, platform, sessionId, threadId), enabled);
}

/**
 * Removes the per-thread adminbox flag from the LRU.
 * Call from admin-only-mode.ts when the setting is toggled so
 * the next enforceAdminOnly invocation reads the fresh value.
 */
export function invalidateThreadAdminBox(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): void {
  lruCache.del(threadKey(userId, platform, sessionId, threadId));
}
