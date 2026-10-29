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
import type { BaseCtx } from '@/engine/types/controller.types.js';
import {
  getMaintenanceModeEnabled,
  peekMaintenanceModeEnabled,
} from '@/engine/repos/maintenance-mode.repo.js';
import { Role } from '@/engine/constants/role.constants.js';
import {
  getUserBanReason,
  getThreadBanReason,
  peekUserBanned,
  peekThreadBanned,
} from '@/engine/repos/banned.repo.js';
import {
  formatUserBanMessage,
  formatGroupBanMessage,
} from '@/engine/lib/ban-message.lib.js';
import { getUserTimezoneOrDefault } from '@/engine/repos/timezone.repo.js';
import { getPayment } from '@/engine/types/module-meta.types.js';
import { createCurrenciesContext } from '@/engine/lib/currencies.lib.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { createChatContext } from '@/engine/adapters/models/context.model.js';

// ── Cooldown ──────────────────────────────────────────────────────────────────

/**
 * Enforces per-user command cooldowns declared in meta.cooldown (seconds).
 * First blocked attempt sends one notice; subsequent attempts in the same window
 * are silently dropped to prevent message flooding.
 */
export const enforceCooldown: MiddlewareFn<OnCommandCtx> = function (
  ctx,
  next,
): Promise<void> | void {
  if (!ctx.parsed || !ctx.mod) return next();

  const cfg = ctx.mod['meta'] as Record<string, unknown> | undefined;
  const cooldownSec = cfg?.['cooldown'];

  if (typeof cooldownSec !== 'number' || cooldownSec <= 0) return next();

  const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? 'unknown') as string;
  const key = `${ctx.parsed.name}:${senderID}`;
  const now = Date.now();

  cooldownStore.pruneIfNeeded(now);

  const entry = cooldownStore.check(key, now);
  if (entry !== null) {
    if (!entry.notified) {
      cooldownStore.markNotified(key);
      const remainingSec = Math.ceil((entry.expiry - now) / 1000);
      // Returning the reply promise keeps the chain correct without an
      // `async` frame on every non-blocked invocation.
      return ctx.chat
        .replyMessage({
          message: `⏳ Please wait ${remainingSec} second${remainingSec !== 1 ? 's' : ''} before using this command again.`,
        })
        .then(() => undefined);
    }
    return;
  }

  cooldownStore.record(key, now, cooldownSec * 1000);
  return next();
};

// ── Payment Enforcement ───────────────────────────────────────────────────────

/**
 * Charges `meta.payment` dollars from the caller's balance before the command
 * executes. When `meta.payment` is absent or configured as 'free', the command
 * runs with no charge (the default). A positive number debits the caller's
 * balance and rejects the command with an insufficient-funds notice if they
 * cannot afford it.
 */
export const enforcePayment: MiddlewareFn<OnCommandCtx> = function (
  ctx,
  next,
): Promise<void> | void {
  if (!ctx.mod) return next();

  const cfg = ctx.mod['meta'] as Record<string, unknown> | undefined;
  const payment = getPayment(cfg);

  if (payment === 'free' || typeof payment !== 'number' || payment <= 0) {
    return next();
  }

  return (async (): Promise<void> => {
    const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string;
    if (!senderID) { await next(); return; }

    const sessionUserId = ctx.native.userId ?? '';
    const sessionId = ctx.native.sessionId ?? '';
    const platform = ctx.native.platform;
    const isSystemAdmin = await cachedIsSystemAdmin(ctx, senderID);
    if (isSystemAdmin) { await next(); return; }
    if (sessionUserId && sessionId) {
      const isBotAdmin = await cachedIsBotAdmin(ctx, sessionUserId, platform, sessionId, senderID);
      if (isBotAdmin) { await next(); return; }
    }
    if (sessionUserId && sessionId) {
      const isPremium = await cachedIsBotPremium(ctx, sessionUserId, platform, sessionId, senderID);
      if (isPremium) { await next(); return; }
    }

    const currencies = createCurrenciesContext(
      ctx.native.userId ?? '',
      ctx.native.platform,
      ctx.native.sessionId ?? '',
    );

    const balance = await currencies.getMoney(senderID);
    if (balance < payment) {
      await ctx.chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `💳 **Insufficient balance to use this command.**\nRequired: **$${payment.toLocaleString()}**\nYour balance: **$${balance.toLocaleString()}**`,
      });
      return;
    }

    await currencies.decreaseMoney({ user_id: senderID, money: payment });
    await next();
  })();
};

// ── Options Parsing ───────────────────────────────────────────────────────────

export const validateCommandOptions: MiddlewareFn<OnCommandCtx> = function (
  ctx,
  next,
): Promise<void> | void {
  if (!ctx.mod) {
    ctx.options = OptionsMap.empty();
    return next();
  }

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

  return next();
};

// ── Role Enforcement ──────────────────────────────────────────────────────────

/**
 * Enforces meta.role: ANYONE (0), THREAD_ADMIN (1), PREMIUM (2), BOT_ADMIN (3),
 * SYSTEM_ADMIN (4). System admins bypass all role gates. Registered before
 * enforceCooldown so unauthorised requests skip cooldown tracking.
 */
export const enforcePermission: MiddlewareFn<OnCommandCtx> = function (
  ctx,
  next,
): Promise<void> | void {
  if (!ctx.mod) return next();

  const cfg = ctx.mod['meta'] as Record<string, unknown> | undefined;
  const role = cfg?.['role'];

  if (typeof role !== 'number' || role === Role.ANYONE) return next();

  return (async (): Promise<void> => {
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
  })();
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
    const sessOff =
      getCachedSessionAdminOnly(sessionUserId, platform, sessionId) === false;
    if (sessOff) {
      if (!threadID) return next();
      const known = await awaitThreadAdminBox(ctx, threadID);
      if (known === false) return next();
      // Unknown or enabled: fall through to the authoritative full check.
    }
  }

  return (async (): Promise<void> => {
    // ── Session-wide admin-only ─────────────────────────────────────────────
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

    // ── Per-thread admin-only ───────────────────────────────────────────────
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
  })();
};

// ── Maintenance Mode Enforcement ─────────────────────────────────────────────────

/**
 * Enforces the global "Maintenance Mode" switch: when enabled, every bot is
 * restricted to System Admins only — non-system-admins are blocked from all
 * commands on every session, on every platform. Mirrors "Bot Admin Only" but
 * at the system level (global setting, not per-session).
 *
 * System admins bypass the restriction. Fail-open on any DB error so a storage
 * hiccup never locks everyone out.
 */
export const enforceMaintenanceMode: MiddlewareFn<OnCommandCtx> = function (
  ctx,
  next,
): Promise<void> | void {
  const cached = peekMaintenanceModeEnabled();
  if (cached === false) return next();

  return (async (): Promise<void> => {
    const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string;

    try {
      const enabled = cached ?? (await getMaintenanceModeEnabled());
      if (!enabled) { await next(); return; }

      if (senderID && (await cachedIsSystemAdmin(ctx, senderID))) { await next(); return; }

      const key = `maintenance_noti:${senderID || 'unknown'}`;
      if (cooldownStore.check(key, Date.now()) === null) {
        await ctx.chat.replyMessage({
          message: '🚫 The bot is under maintenance — only System Admins may use commands right now.',
          attachment_url: [
            {
              name: 'maintenance-mode.png',
              url: 'https://i.postimg.cc/rF1Y5ky9/maintenance-mode.png',
            },
          ],
        });
        cooldownStore.record(key, Date.now(), 15000);
      }
    } catch {
      await next();
    }
  })();
};

// ── Ban Enforcement ───────────────────────────────────────────────────────────

/**
 * Drops commands from banned users or threads silently so banned actors cannot
 * probe their ban status. Runs first in the chain to skip all other middleware.
 * Bot admins and system admins bypass the check. Fail-open on DB errors.
 * Both ban checks run in parallel to save one DB round-trip.
 */
// ── Thread admin-box prefetch ────────────────────────────────────────────────
// The ban gate and the admin-only gate both need a DB read on a cold thread.
// Start the admin-box read at the top of the ban gate so the two round-trips
// overlap instead of running back-to-back. In-flight reads are shared, so
// enforceAdminOnly awaits the same promise rather than issuing a duplicate.

const threadBoxInflight = new Map<string, Promise<boolean>>()

function threadBoxKey(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): string {
  return `${userId}:${platform}:${sessionId}:${threadId}`
}

function prefetchThreadAdminBox(
  ctx: BaseCtx,
  threadID: string,
): Promise<boolean> {
  const userId = ctx.native.userId ?? ''
  const platform = ctx.native.platform
  const sessionId = ctx.native.sessionId ?? ''
  const cached = getCachedThreadAdminBox(userId, platform, sessionId, threadID)
  if (cached !== undefined) return Promise.resolve(cached)

  const key = threadBoxKey(userId, platform, sessionId, threadID)
  const existing = threadBoxInflight.get(key)
  if (existing) return existing

  const task = (async (): Promise<boolean> => {
    try {
      const coll = ctx.db.threads.collection(threadID)
      if (await coll.isCollectionExist('adminbox_settings')) {
        const h = await coll.getCollection('adminbox_settings')
        const settings = await h.getAll()
        const enabled = settings['enabled'] as boolean | null | undefined
        const value = enabled === true
        if (enabled !== null && enabled !== undefined) {
          setCachedThreadAdminBox(userId, platform, sessionId, threadID, value)
        }
        return value
      }
      setCachedThreadAdminBox(userId, platform, sessionId, threadID, false)
      return false
    } catch {
      // Fail-open: do not cache, so the next dispatch retries the read.
      return false
    } finally {
      threadBoxInflight.delete(key)
    }
  })()

  threadBoxInflight.set(key, task)
  return task
}

async function awaitThreadAdminBox(
  ctx: BaseCtx,
  threadID: string,
): Promise<boolean | undefined> {
  const userId = ctx.native.userId ?? ''
  const platform = ctx.native.platform
  const sessionId = ctx.native.sessionId ?? ''
  const cached = getCachedThreadAdminBox(userId, platform, sessionId, threadID)
  if (cached !== undefined) return cached
  const key = threadBoxKey(userId, platform, sessionId, threadID)
  const pending = threadBoxInflight.get(key)
  if (pending) return pending
  return undefined
}

export const enforceNotBanned: MiddlewareFn<OnCommandCtx> = function (
  ctx,
  next,
): Promise<void> | void {
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;

  if (!sessionUserId || !sessionId) return next();

  const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string;
  const threadID = (ctx.event['threadID'] ?? '') as string;

  // Fire-and-forget: overlaps this thread's settings read with the ban read.
  if (threadID) void prefetchThreadAdminBox(ctx, threadID);

  // Synchronous warm-cache fast path: a sender who is not banned and a thread
  // that is not banned cannot be affected by the admin bypass, so the admin
  // lookups are unnecessary. Any cache miss or positive ban falls through to
  // the full async path (including the admin bypass and ban notices).
  const peekedUserBan = senderID
    ? peekUserBanned(sessionUserId, platform, sessionId, senderID)
    : false;
  const peekedThreadBan = threadID
    ? peekThreadBanned(sessionUserId, platform, sessionId, threadID)
    : false;
  if (peekedUserBan === false && peekedThreadBan === false) return next();

  return (async (): Promise<void> => {
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
  })();
};

// ── Usage Guide Factory ───────────────────────────────────────────────────────

/**
 * Creates a bound `usage()` function for a command module.
 *
 * Reads the command's meta (name, usage, description) and sends a formatted
 * usage guide via the provided chat context.
 *
 * @param command  - The loaded command module (exports object).
 * @param chat     - The command-scoped chat context (from createChatContext).
 * @param prefix   - The active prefix string for this session.
 * @returns        An async function that sends the usage guide as a reply.
 *
 * @example
 * // Inside onCommand — show usage when required arg is missing
 * export const onCommand = async ({ args, usage }: AppCtx) => {
 *   if (!args[0]) return usage();
 *   // ...
 * };
 */
export function createUsage(
  command: Record<string, unknown>,
  chat: ReturnType<typeof createChatContext>,
  prefix: string,
): () => Promise<void> {
  return async function usage(): Promise<void> {
    const cfg = (command['meta'] as Record<string, unknown>) ?? {};

    const rawUsage = cfg['usage'];
    const usages: string[] = Array.isArray(rawUsage)
      ? (rawUsage as string[])
      : [typeof rawUsage === 'string' ? rawUsage : ''];

    let text = '▫️ **Usage Guide:**\n\n';
    for (const u of usages)
      text += u
        ? `\`${prefix}${cfg['name']} ${u}\`\n`
        : `\`${prefix}${cfg['name']}\`\n`;
    text += `\n📄 ${(cfg['description'] as string) || 'No description provided.'}`;

    await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: text });
  };
}
