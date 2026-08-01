/**
 * Admin-Only State Cache
 *
 * Caches session-wide admin-only and per-thread adminbox enabled flags in the shared LRU.
 * Allows enforceAdminOnly to skip all async DB reads when both modes are known-off.
 *
 *   cached false    → mode confirmed off; fast-path skip in enforceAdminOnly
 *   cached true     → mode on; full check required
 *   undefined       → not yet seen; full check required (populates on first read)
 *
 * Invalidation: enforceAdminOnly calls set* after every DB read; admin-only-mode.ts calls
 * invalidate* immediately after toggling so the NEXT command sees the updated state.
 */

import { lruCache } from '@/engine/lib/lru-cache.lib.js';

const sessKey = (u: string, p: string, s: string): string =>
  `adminonly:sess:${u}:${p}:${s}`;
const threadKey = (u: string, p: string, s: string, t: string): string =>
  `adminonly:thread:${u}:${p}:${s}:${t}`;

export function getCachedSessionAdminOnly(userId: string, platform: string, sessionId: string): boolean | undefined {
  return lruCache.get<boolean>(sessKey(userId, platform, sessionId));
}
export function setCachedSessionAdminOnly(userId: string, platform: string, sessionId: string, enabled: boolean): void {
  lruCache.set(sessKey(userId, platform, sessionId), enabled);
}
export function invalidateSessionAdminOnly(userId: string, platform: string, sessionId: string): void {
  lruCache.del(sessKey(userId, platform, sessionId));
}

export function getCachedThreadAdminBox(userId: string, platform: string, sessionId: string, threadId: string): boolean | undefined {
  return lruCache.get<boolean>(threadKey(userId, platform, sessionId, threadId));
}
export function setCachedThreadAdminBox(userId: string, platform: string, sessionId: string, threadId: string, enabled: boolean): void {
  lruCache.set(threadKey(userId, platform, sessionId, threadId), enabled);
}
export function invalidateThreadAdminBox(userId: string, platform: string, sessionId: string, threadId: string): void {
  lruCache.del(threadKey(userId, platform, sessionId, threadId));
}
