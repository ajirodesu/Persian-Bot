/**
 * Request-Scoped Authorization Cache
 *
 * Wraps the six repo-level authorization checks with per-request memoization on ctx._authCache.
 * The shared LRU cache (repo layer) provides cross-request deduplication; this layer eliminates
 * redundant async calls within the SAME middleware chain run.
 *
 * The cache stores in-flight PROMISES, not resolved values — middleware now fans
 * checks out concurrently (e.g. Promise.all), so two concurrent calls with the
 * same key share one underlying repo read instead of both missing and doubling
 * the DB round trip. Rejections are evicted so a transient failure is retried
 * on the next call rather than cached as an error.
 */

import type { BaseCtx } from '@/engine/types/controller.types.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { isBotAdmin, isBotPremium } from '@/engine/repos/credentials.repo.js';
import { isUserBanned, isThreadBanned } from '@/engine/repos/banned.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';

async function memo(ctx: BaseCtx, key: string, fn: () => Promise<boolean>): Promise<boolean> {
  const valueCache = (ctx._authCache ??= new Map<string, boolean>());
  const hit = valueCache.get(key);
  if (hit !== undefined) return hit;

  // Cross-call dedupe store (separate from the resolved-value cache above so
  // its type stays Map<string, boolean>).
  const inflightCache = (ctx._authInflight ??= new Map<string, Promise<boolean>>());
  const inflight = inflightCache.get(key);
  if (inflight) return inflight;

  const p = fn()
    .then((result) => {
      valueCache.set(key, result);
      return result;
    })
    .finally(() => {
      inflightCache.delete(key);
    });
  inflightCache.set(key, p);
  return p;
}

/** Memoized isSystemAdmin — global check, keyed on adminId only. */
export function cachedIsSystemAdmin(ctx: BaseCtx, adminId: string): Promise<boolean> {
  return memo(ctx, `sys:${adminId}`, () => isSystemAdmin(adminId));
}

/** Memoized isBotAdmin — keyed on (userId, platform, sessionId, senderId). */
export function cachedIsBotAdmin(ctx: BaseCtx, userId: string, platform: string, sessionId: string, senderId: string): Promise<boolean> {
  return memo(ctx, `ba:${userId}:${platform}:${sessionId}:${senderId}`, () => isBotAdmin(userId, platform, sessionId, senderId));
}

/** Memoized isBotPremium — keyed on (userId, platform, sessionId, senderId). */
export function cachedIsBotPremium(ctx: BaseCtx, userId: string, platform: string, sessionId: string, senderId: string): Promise<boolean> {
  return memo(ctx, `bp:${userId}:${platform}:${sessionId}:${senderId}`, () => isBotPremium(userId, platform, sessionId, senderId));
}

/** Memoized isUserBanned — keyed on (userId, platform, sessionId, botUserId). */
export function cachedIsUserBanned(ctx: BaseCtx, userId: string, platform: string, sessionId: string, botUserId: string): Promise<boolean> {
  return memo(ctx, `ub:${userId}:${platform}:${sessionId}:${botUserId}`, () => isUserBanned(userId, platform, sessionId, botUserId));
}

/** Memoized isThreadBanned — keyed on (userId, platform, sessionId, botThreadId). */
export function cachedIsThreadBanned(ctx: BaseCtx, userId: string, platform: string, sessionId: string, botThreadId: string): Promise<boolean> {
  return memo(ctx, `tb:${userId}:${platform}:${sessionId}:${botThreadId}`, () => isThreadBanned(userId, platform, sessionId, botThreadId));
}

/** Memoized isThreadAdmin — keyed on (threadId, userId). */
export function cachedIsThreadAdmin(ctx: BaseCtx, threadId: string, userId: string): Promise<boolean> {
  return memo(ctx, `ta:${threadId}:${userId}`, () => isThreadAdmin(threadId, userId));
}
