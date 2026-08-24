/**
 * Request-Scoped Authorization Cache
 *
 * Wraps the six repo-level authorization checks with per-request memoization on ctx._authCache.
 * The shared LRU cache (repo layer) provides cross-request deduplication; this layer eliminates
 * redundant async calls within the SAME middleware chain run.
 *
 * Sequential middleware guarantees: no concurrent call risk — a synchronous Map lookup suffices.
 */

import type { BaseCtx } from '@/engine/types/controller.types.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { isBotAdmin, isBotPremium } from '@/engine/repos/credentials.repo.js';
import { isUserBanned, isThreadBanned } from '@/engine/repos/banned.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';

async function memo(ctx: BaseCtx, key: string, fn: () => Promise<boolean>): Promise<boolean> {
  if (!ctx._authCache) ctx._authCache = new Map<string, boolean>();
  const hit = ctx._authCache.get(key);
  if (hit !== undefined) return hit;
  const result = await fn();
  ctx._authCache.set(key, result);
  return result;
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
