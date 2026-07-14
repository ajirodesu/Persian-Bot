/**
 * Request-Scoped Authorization Cache
 *
 * Wraps the six repo-level authorization checks with a per-request memoization
 * layer stored on ctx._authCache.  The LRU cache in each repo already provides
 * cross-request caching; this layer eliminates the overhead of redundant async
 * calls within the SAME pipeline run.
 *
 * Why both layers?
 *   - LRU (repo layer)  → cross-request deduplication, survives across many messages.
 *   - Map (this layer)  → within-request deduplication; removes Promise overhead for
 *     the second, third … call to the same check inside one middleware chain.
 *
 * Sequential middleware guarantee: because runMiddlewareChain executes each
 * middleware one at a time, there is no concurrent call risk.  A simple synchronous
 * Map lookup is sufficient — no Promise.race or "in-flight promise" pattern needed.
 *
 * Usage:
 *   import { cachedIsSystemAdmin, cachedIsBotAdmin, … } from '@/engine/lib/auth-cache.lib.js';
 *   const yes = await cachedIsSystemAdmin(ctx, senderID);
 */

import type { BaseCtx } from '@/engine/types/controller.types.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { isBotAdmin, isBotPremium } from '@/engine/repos/credentials.repo.js';
import { isUserBanned, isThreadBanned } from '@/engine/repos/banned.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';

// ── Internal helper ──────────────────────────────────────────────────────────

/**
 * Checks ctx._authCache for `key`; if absent, calls `fn()`, stores the result,
 * and returns it.  Initialises ctx._authCache on first call.
 */
async function memo(
  ctx: BaseCtx,
  key: string,
  fn: () => Promise<boolean>,
): Promise<boolean> {
  if (!ctx._authCache) ctx._authCache = new Map<string, boolean>();
  const hit = ctx._authCache.get(key);
  if (hit !== undefined) return hit;
  const result = await fn();
  ctx._authCache.set(key, result);
  return result;
}

// ── Public cached wrappers ────────────────────────────────────────────────────

/** Memoized isSystemAdmin — keyed on adminId only (global check, no session scope). */
export function cachedIsSystemAdmin(
  ctx: BaseCtx,
  adminId: string,
): Promise<boolean> {
  return memo(ctx, `sys:${adminId}`, () => isSystemAdmin(adminId));
}

/** Memoized isBotAdmin — keyed on the full (userId, platform, sessionId, senderId) tuple. */
export function cachedIsBotAdmin(
  ctx: BaseCtx,
  userId: string,
  platform: string,
  sessionId: string,
  senderId: string,
): Promise<boolean> {
  return memo(
    ctx,
    `ba:${userId}:${platform}:${sessionId}:${senderId}`,
    () => isBotAdmin(userId, platform, sessionId, senderId),
  );
}

/** Memoized isBotPremium — keyed on the full (userId, platform, sessionId, senderId) tuple. */
export function cachedIsBotPremium(
  ctx: BaseCtx,
  userId: string,
  platform: string,
  sessionId: string,
  senderId: string,
): Promise<boolean> {
  return memo(
    ctx,
    `bp:${userId}:${platform}:${sessionId}:${senderId}`,
    () => isBotPremium(userId, platform, sessionId, senderId),
  );
}

/** Memoized isUserBanned — keyed on the full (userId, platform, sessionId, botUserId) tuple. */
export function cachedIsUserBanned(
  ctx: BaseCtx,
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<boolean> {
  return memo(
    ctx,
    `ub:${userId}:${platform}:${sessionId}:${botUserId}`,
    () => isUserBanned(userId, platform, sessionId, botUserId),
  );
}

/** Memoized isThreadBanned — keyed on the full (userId, platform, sessionId, botThreadId) tuple. */
export function cachedIsThreadBanned(
  ctx: BaseCtx,
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<boolean> {
  return memo(
    ctx,
    `tb:${userId}:${platform}:${sessionId}:${botThreadId}`,
    () => isThreadBanned(userId, platform, sessionId, botThreadId),
  );
}

/** Memoized isThreadAdmin — keyed on (threadId, userId). */
export function cachedIsThreadAdmin(
  ctx: BaseCtx,
  threadId: string,
  userId: string,
): Promise<boolean> {
  return memo(
    ctx,
    `ta:${threadId}:${userId}`,
    () => isThreadAdmin(threadId, userId),
  );
}
