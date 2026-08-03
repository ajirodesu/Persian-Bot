/**
 * onCommand Middleware — cooldown, option parsing, permission, admin-only, and ban enforcement.
 * Each guard is a separate exported MiddlewareFn registered in index.ts.
 */

import type { MiddlewareFn, OnCommandCtx } from '@/engine/types/middleware.types.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import type { OptionDef } from '@/engine/modules/options/options-map.lib.js';
import { parseTextOptions } from '@/engine/modules/options/options.util.js';
import { cooldownStore } from '@/engine/lib/cooldown.lib.js';
import {
  cachedIsSystemAdmin,
  cachedIsBotAdmin,
  cachedIsBotPremium,
  cachedIsUserBanned,
  cachedIsThreadBanned,
  cachedIsThreadAdmin,
} from '@/engine/lib/auth-cache.lib.js';
import {
  getCachedSessionAdminOnly,
  setCachedSessionAdminOnly,
  getCachedThreadAdminBox,
  setCachedThreadAdminBox,
} from '@/engine/lib/admin-only-state.lib.js';
import { Role } from '@/engine/constants/role.constants.js';
import {
  getUserBanReason,
  getThreadBanReason,
} from '@/engine/repos/banned.repo.js';
import {
  formatUserBanMessage,
  formatGroupBanMessage,
} from '@/engine/lib/ban-message.lib.js';
import { getUserTimezoneOrDefault } from '@/engine/repos/timezone.repo.js';

// ── Cooldown ──────────────────────────────────────────────────────────────────

/**
 * Enforces per-user command cooldowns declared in meta.cooldown (seconds).
 * First blocked attempt sends one notice; subsequent attempts in the same window
 * are silently dropped to prevent message flooding.
 */
export const enforceCooldown: MiddlewareFn<OnCommandCtx> = async function (
  ctx,
  next,
): Promise<void> {
  if (!ctx.parsed || !ctx.mod) { await next(); return; }

  const cfg = ctx.mod['meta'] as Record<string, unknown> | undefined;
  const cooldownSec = cfg?.['cooldown'];

  if (typeof cooldownSec !== 'number' || cooldownSec <= 0) { await next(); return; }

  const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? 'unknown') as string;
  const key = `${ctx.parsed.name}:${senderID}`;
  const now = Date.now();

  cooldownStore.pruneIfNeeded(now);

  const entry = cooldownStore.check(key, now);
  if (entry !== null) {
    if (!entry.notified) {
      cooldownStore.markNotified(key);
      const remainingSec = Math.ceil((entry.expiry - now) / 1000);
      await ctx.chat.replyMessage({
        message: `⏳ Please wait ${remainingSec} second${remainingSec !== 1 ? 's' : ''} before using this command again.`,
      });
    }
    return; // blocked — do not call next()
  }

  cooldownStore.record(key, now, cooldownSec * 1000);
  await next();
};

// ── Options Parsing ───────────────────────────────────────────────────────────

export const validateCommandOptions: MiddlewareFn<OnCommandCtx> = async function (
  ctx,
  next,
): Promise<void> {
  if (!ctx.mod) { ctx.options = OptionsMap.empty(); await next(); return; }

  const cfg = ctx.mod['meta'] as Record<string, unknown> | undefined;
  const optionDefs = (cfg?.['options'] as OptionDef[] | undefined) ?? [];

  if (optionDefs.length > 0) {
    // Discord slash commands embed pre-resolved values to preserve type coercion.
    const preBuilt = ctx.event['optionsRecord'] as Record<string, string> | undefined;
    ctx.options =
      preBuilt !== undefined
        ? new OptionsMap(preBuilt)
        : new OptionsMap(
            parseTextOptions(
              (ctx.event['message'] ?? ctx.event['body'] ?? '') as string,
              optionDefs,
            ),
          );
  } else {
    ctx.options = OptionsMap.empty();
  }

  await next();
};

// ── Role Enforcement ──────────────────────────────────────────────────────────

/**
 * Enforces meta.role: ANYONE (0), THREAD_ADMIN (1), BOT_ADMIN (2), PREMIUM (3),
 * SYSTEM_ADMIN (4). System admins bypass all role gates. Registered before
 * enforceCooldown so unauthorised requests skip cooldown tracking.
 */
export const enforcePermission: MiddlewareFn<OnCommandCtx> = async function (
  ctx,
  next,
): Promise<void> {
  if (!ctx.mod) { await next(); return; }

  const cfg = ctx.mod['meta'] as Record<string, unknown> | undefined;
  const role = cfg?.['role'];

  if (typeof role !== 'number' || role === Role.ANYONE) { await next(); return; }

  const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string;
  const threadID = (ctx.event['threadID'] ?? '') as string;

  // System admins inherit every role — short-circuit before any specific gate.
  if (senderID) {
    const isSysAdmin = await cachedIsSystemAdmin(ctx, senderID);
    if (isSysAdmin) { await next(); return; }
  }

  if (role === Role.SYSTEM_ADMIN) {
    await ctx.chat.replyMessage({ message: '🚫 This command is restricted to system admins.' });
    return;
  }

  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;

  if (role === Role.THREAD_ADMIN) {
    // For Discord, isThreadAdmin checks the parent server's admin list.
    let allowed = await cachedIsThreadAdmin(ctx, threadID, senderID);
    if (!allowed) allowed = await cachedIsBotAdmin(ctx, sessionUserId, platform, sessionId, senderID);
    if (!allowed) allowed = await cachedIsBotPremium(ctx, sessionUserId, platform, sessionId, senderID);
    if (!allowed) {
      await ctx.chat.replyMessage({ message: '🚫 This command is restricted to group admins.' });
      return;
    }
  } else if (role === Role.BOT_ADMIN) {
    const allowed = await cachedIsBotAdmin(ctx, sessionUserId, platform, sessionId, senderID);
    if (!allowed) {
      await ctx.chat.replyMessage({ message: '🚫 This command is restricted to bot admins.' });
      return;
    }
  } else if (role === Role.PREMIUM) {
    let allowed = await cachedIsBotAdmin(ctx, sessionUserId, platform, sessionId, senderID);
    if (!allowed) allowed = await cachedIsBotPremium(ctx, sessionUserId, platform, sessionId, senderID);
    if (!allowed) {
      await ctx.chat.replyMessage({ message: '🚫 This command is restricted to premium users.' });
      return;
    }
  }

  await next();
};

// ── Admin-Only Enforcement ────────────────────────────────────────────────────

/**
 * Enforces two admin-only restriction modes:
 *   1. Session-wide (adminonly): stored in db.bot → 'session_settings'
 *   2. Per-thread (onlyadminbox): stored in db.threads.collection(threadID) → 'adminbox_settings'
 *
 * Both support an ignoreList and optional hideNoti. Fail-open on any DB error.
 * Uses a fast-path LRU cache to skip DB reads when both modes are known-off.
 */
export const enforceAdminOnly: MiddlewareFn<OnCommandCtx> = async function (
  ctx,
  next,
): Promise<void> {
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;
  const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string;
  const threadID = (ctx.event['threadID'] ?? '') as string;

  const cfg = (ctx.mod as Record<string, unknown> | undefined)?.['meta'] as Record<string, unknown> | undefined;
  const cmdName = ((cfg?.['name'] as string | undefined) ?? ctx.parsed?.name ?? '').toLowerCase();
  const now = Date.now();

  // Fast-path: skip all async reads when both modes are known-off for Role.ANYONE commands.
  const cmdRole = (cfg?.['role'] as number | undefined) ?? Role.ANYONE;
  if (cmdRole === Role.ANYONE && sessionUserId && sessionId) {
    const sessOff = getCachedSessionAdminOnly(sessionUserId, platform, sessionId) === false;
    const threadOff = !threadID || getCachedThreadAdminBox(sessionUserId, platform, sessionId, threadID) === false;
    if (sessOff && threadOff) { await next(); return; }
  }

  // ── Session-wide admin-only ─────────────────────────────────────────────────
  try {
    const botColl = ctx.db.bot;
    if (await botColl.isCollectionExist('session_settings')) {
      const h = await botColl.getCollection('session_settings');
      const settings = await h.getAll();
      const enabled = settings['adminOnlyEnabled'] as boolean | null;
      if (enabled !== null && enabled !== undefined && sessionUserId && sessionId) {
        setCachedSessionAdminOnly(sessionUserId, platform, sessionId, enabled === true);
      }
      if (enabled === true) {
        const isSysAdmin = senderID ? await cachedIsSystemAdmin(ctx, senderID) : false;
        if (isSysAdmin) { await next(); return; }
        const isAdmin =
          senderID && sessionUserId && sessionId
            ? await cachedIsBotAdmin(ctx, sessionUserId, platform, sessionId, senderID)
            : false;
        if (!isAdmin) {
          const ignoreList = (settings['adminOnlyIgnoreList'] as string[] | null) ?? [];
          if (!ignoreList.includes(cmdName)) {
            const hideNoti = settings['adminOnlyHideNoti'] as boolean | null;
            if (hideNoti !== true) {
              const key = `adminonly_noti:${sessionUserId}:${platform}:${sessionId}:${senderID}`;
              if (cooldownStore.check(key, now) === null) {
                await ctx.chat.replyMessage({
                  message: '🚫 The bot is currently in admin-only mode. Only bot admins may use commands.',
                });
                cooldownStore.record(key, now, 15000);
              }
            }
            return;
          }
        }
      }
    } else if (sessionUserId && sessionId) {
      setCachedSessionAdminOnly(sessionUserId, platform, sessionId, false);
    }
  } catch { /* fail-open */ }

  // ── Per-thread admin-only ───────────────────────────────────────────────────
  if (threadID) {
    try {
      const threadColl = ctx.db.threads.collection(threadID);
      if (await threadColl.isCollectionExist('adminbox_settings')) {
        const h = await threadColl.getCollection('adminbox_settings');
        const settings = await h.getAll();
        const enabled = settings['enabled'] as boolean | null;
        if (enabled !== null && enabled !== undefined && sessionUserId && sessionId) {
          setCachedThreadAdminBox(sessionUserId, platform, sessionId, threadID, enabled === true);
        }
        if (enabled === true) {
          const ignoreList = (settings['ignoreList'] as string[] | null) ?? [];
          if (!ignoreList.includes(cmdName)) {
            const isSysAdmin = senderID ? await cachedIsSystemAdmin(ctx, senderID) : false;
            let allowed = isSysAdmin;
            if (!allowed && senderID && sessionUserId && sessionId) {
              allowed = await cachedIsBotAdmin(ctx, sessionUserId, platform, sessionId, senderID);
            }
            if (!allowed && senderID) allowed = await cachedIsThreadAdmin(ctx, threadID, senderID);
            if (!allowed) {
              const hideNoti = settings['hideNoti'] as boolean | null;
              if (hideNoti !== true) {
                const key = `adminbox_noti:${sessionUserId}:${platform}:${sessionId}:${threadID}:${senderID}`;
                if (cooldownStore.check(key, now) === null) {
                  await ctx.chat.replyMessage({
                    message: '🚫 Only group admins can use the bot in this thread.',
                  });
                  cooldownStore.record(key, now, 15000);
                }
              }
              return;
            }
          }
        }
      } else if (sessionUserId && sessionId) {
        setCachedThreadAdminBox(sessionUserId, platform, sessionId, threadID, false);
      }
    } catch { /* fail-open */ }
  }

  await next();
};

// ── Ban Enforcement ───────────────────────────────────────────────────────────

/**
 * Drops commands from banned users or threads silently so banned actors cannot
 * probe their ban status. Runs first in the chain to skip all other middleware.
 * Bot admins and system admins bypass the check. Fail-open on DB errors.
 * Both ban checks run in parallel to save one DB round-trip.
 */
export const enforceNotBanned: MiddlewareFn<OnCommandCtx> = async function (
  ctx,
  next,
): Promise<void> {
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;

  if (!sessionUserId || !sessionId) { await next(); return; }

  const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string;
  const threadID = (ctx.event['threadID'] ?? '') as string;
  const now = Date.now();

  if (senderID) {
    const isAdmin = await cachedIsBotAdmin(ctx, sessionUserId, platform, sessionId, senderID);
    const isSysAdmin = isAdmin ? false : await cachedIsSystemAdmin(ctx, senderID);
    if (isAdmin || isSysAdmin) { await next(); return; }
  }

  const [userBanned, threadBanned] = await Promise.all([
    senderID ? cachedIsUserBanned(ctx, sessionUserId, platform, sessionId, senderID) : Promise.resolve(false),
    threadID ? cachedIsThreadBanned(ctx, sessionUserId, platform, sessionId, threadID) : Promise.resolve(false),
  ]);

  if (userBanned) {
    const key = `ban_u:${sessionUserId}:${platform}:${sessionId}:${senderID}`;
    if (!cooldownStore.check(key, now)) {
      const [reason, timezone] = await Promise.all([
        getUserBanReason(sessionUserId, platform, sessionId, senderID),
        getUserTimezoneOrDefault(sessionUserId),
      ]);
      await ctx.chat.replyMessage({ message: formatUserBanMessage({ reason, userId: senderID, timezone }) });
      cooldownStore.record(key, now, 15000);
    }
    return;
  }

  if (threadBanned) {
    const key = `ban_t:${sessionUserId}:${platform}:${sessionId}:${threadID}`;
    if (!cooldownStore.check(key, now)) {
      const [reason, timezone] = await Promise.all([
        getThreadBanReason(sessionUserId, platform, sessionId, threadID),
        getUserTimezoneOrDefault(sessionUserId),
      ]);
      await ctx.chat.replyMessage({ message: formatGroupBanMessage({ reason, threadId: threadID, timezone }) });
      cooldownStore.record(key, now, 15000);
    }
    return;
  }

  await next();
};
