/**
 * onCommand Middleware — Cooldown Enforcement + Options Parsing and Validation
 *
 * Extracts the guard block that previously lived in command.dispatcher.ts (lines 45–74).
 * Moving it here means:
 *   - command.dispatcher.ts is reduced to routing + chain invocation only
 *   - Additional command-level guards (auth, rate limiting, permission checks) can be
 *     inserted before or after this one via use.onCommand([...]) in index.ts
 *
 * Cooldown state has been further extracted to lib/cooldown.lib.ts so this file
 * owns only dispatch logic — zero mutable state lives here.
 *
 * Two parse paths (preserved from the original dispatcher):
 *   Discord slash ('/' prefix) → pre-resolved values in event.optionsRecord
 *                                 (set by event-handlers.ts to preserve Discord type coercion)
 *   All other platforms         → raw message body scanned with key: value regex
 *
 * Short-circuit: sends a user-facing usage error and returns WITHOUT calling next()
 * when any required option is absent — the onCommand handler never executes.
 * Options are mutated onto ctx so subsequent middleware and the final handler can read them.
 *
 * Auth memoization: all six authorization/ban checks (isSystemAdmin, isBotAdmin,
 * isBotPremium, isUserBanned, isThreadBanned, isThreadAdmin) are routed through
 * the request-scoped cache in lib/auth-cache.lib.ts.  This eliminates redundant
 * async calls when multiple middlewares need the same result for the same sender
 * within one pipeline run — even the first call is deduped so no check ever runs
 * twice within the same request.
 */

import type {
  MiddlewareFn,
  OnCommandCtx,
} from '@/engine/types/middleware.types.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import type { OptionDef } from '@/engine/modules/options/options-map.lib.js';
import { parseTextOptions } from '@/engine/modules/options/options.util.js';
// Cooldown state delegated to lib/ — mirrors state.lib.ts pattern;
// this middleware file stays free of mutable Map declarations.
import { cooldownStore } from '@/engine/lib/cooldown.lib.js';
// Request-scoped memoized wrappers — every auth check goes through these so each
// DB/LRU lookup is performed at most once per middleware chain invocation.
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

// ── Cooldown Enforcement ─────────────────────────────────────────────────────

/**
 * Enforces per-user command cooldowns declared in meta.cooldown (seconds).
 *
 * First blocked attempt  → sends ONE "please wait N seconds" notice, latches notified flag.
 * Subsequent blocked attempts → silent no-op; no additional messages sent.
 * This hard cap of one notification per cooldown window prevents message flooding
 * when a user rapidly retries a command they have already been warned about.
 *
 * Registered BEFORE validateCommandOptions in the chain so option parsing is
 * skipped entirely for a command that will be rejected anyway.
 */
export const enforceCooldown: MiddlewareFn<OnCommandCtx> = async function (
  ctx,
  next,
): Promise<void> {
  // Options/Cooldown/Permission middlewares silently skip if no parsed command/mod exists.
  if (!ctx.parsed || !ctx.mod) {
    await next();
    return;
  }

  const cfg = ctx.mod['meta'] as Record<string, unknown> | undefined;
  const cooldownSec = cfg?.['cooldown'];

  // Commands that omit cooldown or set it to 0 skip this middleware entirely.
  if (typeof cooldownSec !== 'number' || cooldownSec <= 0) {
    await next();
    return;
  }

  // Scope per-user so two different users on the same command never block each other.
  const senderID = (ctx.event['senderID'] ??
    ctx.event['userID'] ??
    'unknown') as string;
  const key = `${ctx.parsed.name}:${senderID}`;
  const now = Date.now();

  // Lazy eviction delegated to the store — keeps this middleware free of Map management.
  cooldownStore.pruneIfNeeded(now);

  const entry = cooldownStore.check(key, now);
  if (entry !== null) {
    if (!entry.notified) {
      // First blocked attempt — send the notice exactly once and latch the flag.
      // All subsequent attempts within this window are silently dropped (no spam).
      cooldownStore.markNotified(key);
      const remainingSec = Math.ceil((entry.expiry - now) / 1000);
      await ctx.chat.replyMessage({
        message: `⏳ Please wait ${remainingSec} second${remainingSec !== 1 ? 's' : ''} before using this command again.`,
      });
    }
    // Do NOT call next() — command is blocked regardless of notification state.
    return;
  }

  // Cooldown expired or first invocation — register a fresh window before proceeding
  // so the window starts at invocation time, not after the handler finishes.
  cooldownStore.record(key, now, cooldownSec * 1000);
  await next();
};

// ── Options Parsing + Validation ─────────────────────────────────────────────

export const validateCommandOptions: MiddlewareFn<OnCommandCtx> =
  async function (ctx, next): Promise<void> {
    if (!ctx.mod) {
      ctx.options = OptionsMap.empty();
      await next();
      return;
    }

    const cfg = ctx.mod['meta'] as Record<string, unknown> | undefined;
    const optionDefs = (cfg?.['options'] as OptionDef[] | undefined) ?? [];

    if (optionDefs.length > 0) {
      // Discord slash commands embed pre-resolved values so interaction.options type
      // coercion and native validation are preserved. All other platforms re-parse the body.
      const preBuilt = ctx.event['optionsRecord'] as
        | Record<string, string>
        | undefined;

      const options =
        preBuilt !== undefined
          ? new OptionsMap(preBuilt)
          : new OptionsMap(
              parseTextOptions(
                (ctx.event['message'] ?? ctx.event['body'] ?? '') as string,
                optionDefs,
              ),
            );

      // Options are parsed and available on ctx.options — validation errors are intentionally
      // suppressed so command handlers receive options as-is and decide how to handle missing values.
      ctx.options = options;
    } else {
      // No options defined — set empty map so the handler always has ctx.options available.
      ctx.options = OptionsMap.empty();
    }

    await next();
  };

// ── Role Enforcement ──────────────────────────────────────────────────────────

/**
 * Enforces meta.role declared on each command module.
 *
 * Role levels:
 *   Role.ANYONE (0)       — any user can invoke the command (public default)
 *   Role.THREAD_ADMIN (1) — only thread admins (bot_threads.admins relation) can invoke
 *   Role.BOT_ADMIN (2)    — only bot admins (BotAdmin table for this owner session) can invoke
 *
 * Registered BEFORE enforceCooldown in the chain so an unauthorised attempt is
 * rejected immediately without consuming the user's cooldown window or running
 * options parsing — both of which are wasted work on denied requests.
 *
 * Fail-safe on missing DB state: if the thread has not yet been synced when
 * Role.THREAD_ADMIN, isThreadAdmin returns false and the command is denied rather
 * than making a live platform API call from inside the guard.
 *
 * If sessionUserId or sessionId is absent from native context (rare during early
 * boot or in test harnesses that do not populate them), isBotAdmin receives empty
 * strings and returns false — the Role.BOT_ADMIN command is correctly denied.
 *
 * All repo calls are routed through the request-scoped auth cache so results
 * computed here are free cache hits for enforceAdminOnly / enforceNotBanned.
 */
export const enforcePermission: MiddlewareFn<OnCommandCtx> = async function (
  ctx,
  next,
): Promise<void> {
  if (!ctx.mod) {
    await next();
    return;
  }

  const cfg = ctx.mod['meta'] as Record<string, unknown> | undefined;
  const role = cfg?.['role'];

  // Role.ANYONE (0) or absent: no privilege check needed, advance immediately
  if (typeof role !== 'number' || role === Role.ANYONE) {
    await next();
    return;
  }

  // Both IDs are required for any permission check; fall through if they are absent
  const senderID = (ctx.event['senderID'] ??
    ctx.event['userID'] ??
    '') as string;
  const threadID = (ctx.event['threadID'] ?? '') as string;
  // System admins hold the highest authority and inherit every role below them.
  // Short-circuit here before any specific role gate runs — this single check
  // also makes Role.SYSTEM_ADMIN commands reachable: the deny branch below is
  // only reached when the sender is NOT a system admin.
  if (senderID) {
    const isSysAdmin = await cachedIsSystemAdmin(ctx, senderID);
    if (isSysAdmin) {
      await next();
      return;
    }
  }

  if (role === Role.SYSTEM_ADMIN) {
    // Sender is not a system admin — the bypass above would have short-circuited.
    // No role below SYSTEM_ADMIN (BOT_ADMIN, PREMIUM, THREAD_ADMIN, ANYONE) may
    // invoke a SYSTEM_ADMIN command, so deny unconditionally here.
    await ctx.chat.replyMessage({
      message: '🚫 This command is restricted to system admins.',
    });
    return;
  }

  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;

  if (role === Role.THREAD_ADMIN) {
    // Thread-admin gate: on-chat.middleware has already synced the thread before
    // any command dispatcher runs, so bot_threads should contain the admins list.
    // WHY: For Discord, isThreadAdmin intercepts the call and checks the parent Server's admin
    // list instead, meaning server admins automatically have permission in all its channels.
    let allowed = await cachedIsThreadAdmin(ctx, threadID, senderID);

    // Bot admins and premium users both inherit thread-admin privileges —
    // premium grants a superset (ANYONE + THREAD_ADMIN + PREMIUM).
    if (!allowed) {
      allowed = await cachedIsBotAdmin(
        ctx,
        sessionUserId,
        platform,
        sessionId,
        senderID,
      );
      if (!allowed) {
        // Premium users can run thread-admin commands; thread-admin alone does NOT
        // grant premium access — the privilege relationship is one-directional.
        allowed = await cachedIsBotPremium(
          ctx,
          sessionUserId,
          platform,
          sessionId,
          senderID,
        );
      }
    }

    if (!allowed) {
      await ctx.chat.replyMessage({
        message: '🚫 This command is restricted to group admins.',
      });
      return; // Do NOT call next() — chain halts; handler never runs
    }
  } else if (role === Role.BOT_ADMIN) {
    // Bot-admin gate: BotAdmin rows are provisioned via the web dashboard by the
    // bot owner; senderID must match an adminId scoped to this exact owner session.
    const allowed = await cachedIsBotAdmin(
      ctx,
      sessionUserId,
      platform,
      sessionId,
      senderID,
    );
    if (!allowed) {
      await ctx.chat.replyMessage({
        message: '🚫 This command is restricted to bot admins.',
      });
      return; // Do NOT call next() — chain halts; handler never runs
    }
  } else if (role === Role.PREMIUM) {
    // Premium-gate: premium users and bot admins may invoke; SYSTEM_ADMIN bypassed above.
    // Thread admins alone do NOT qualify — PREMIUM (2) sits above THREAD_ADMIN (1) in the
    // hierarchy, so a thread-admin role alone never satisfies the PREMIUM gate.
    let allowed = await cachedIsBotAdmin(
      ctx,
      sessionUserId,
      platform,
      sessionId,
      senderID,
    );
    if (!allowed) {
      allowed = await cachedIsBotPremium(
        ctx,
        sessionUserId,
        platform,
        sessionId,
        senderID,
      );
    }
    if (!allowed) {
      await ctx.chat.replyMessage({
        message: '🚫 This command is restricted to premium users.',
      });
      return; // Do NOT call next() — chain halts; handler never runs
    }
  }

  // role > 4 (SYSTEM_ADMIN) or unrecognised future value: fall through and allow (forward-compatible default)
  await next();
};

// ── Admin-Only Enforcement (onlyadminbox + adminonly) ────────────────────────

/**
 * Enforces the two admin-only restriction modes managed by the
 * adminonly / ignoreonlyad / onlyadminbox / ignoreonlyadbox commands.
 *
 *   1. Session-wide admin-only mode (adminonly):
 *        db.users.collection(sessionUserId) → 'session_settings'
 *        db.bot → 'session_settings'
 *          adminOnlyEnabled    : boolean
 *          adminOnlyHideNoti   : boolean
 *          adminOnlyIgnoreList : string[]
 *      not present on adminOnlyIgnoreList.
 *
 *   2. Per-thread admin-only mode (onlyadminbox):
 *        db.threads.collection(threadID) → 'adminbox_settings'
 *          enabled    : boolean
 *          hideNoti   : boolean
 *          ignoreList : string[]
 *      When enabled, only thread admins (and bot/system admins) may run any
 *      command in this thread not present on ignoreList.
 *
 * Bypass order (most → least privileged):
 *   system admin → bot admin → thread admin (for thread-level only)
 *
 * Notification suppression mirrors the ban-check pattern: when hideNoti is
 * false the user is informed, but the notice is rate-limited via cooldownStore
 * so a flood of blocked invocations does not produce a flood of replies.
 *
 * Fail-open on any DB read error so a temporary outage does not lock everyone
 * out — consistent with enforceNotBanned's defensive posture.
 *
 * Registered AFTER enforcePermission so commands that already require
 * BOT_ADMIN / SYSTEM_ADMIN never re-check, and BEFORE enforceCooldown so a
 * blocked user does not consume their cooldown window.
 *
 * Performance: isSystemAdmin and isBotAdmin are only resolved AFTER confirming
 * that admin-only mode is actually enabled for the session or thread.  When the
 * feature is disabled (the common case) no auth DB lookups are performed here at
 * all — the settings read is the only I/O.  All auth lookups use the request-
 * scoped cache so they are free hits when enforcePermission / enforceNotBanned
 * already resolved them earlier in the same pipeline run.
 */
export const enforceAdminOnly: MiddlewareFn<OnCommandCtx> = async function (
  ctx,
  next,
): Promise<void> {
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;
  const senderID = (ctx.event['senderID'] ??
    ctx.event['userID'] ??
    '') as string;
  const threadID = (ctx.event['threadID'] ?? '') as string;

  // Resolve canonical command name from the module meta so aliases share the
  // same ignore-list entry (typing /adonly behaves the same as /adminonly).
  // Falls back to parsed.name for unknown commands, or '' for bare-prefix
  // invocations — both cases still apply the restriction (ignoreList.includes('')
  // is always false, so bare-prefix is never exempt).
  const cfg = (ctx.mod as Record<string, unknown> | undefined)?.[
    'meta'
  ] as Record<string, unknown> | undefined;
  const cmdName = (
    (cfg?.['name'] as string | undefined) ?? ctx.parsed?.name ?? ''
  ).toLowerCase();
  const now = Date.now();

  // ── Fast-path skip for Role.ANYONE commands ──────────────────────────────
  // After the first request per session/thread the LRU holds the enabled flags.
  // When both are known-false we skip all async DB reads — no Promise chain,
  // no LRU traversal beyond two synchronous lruCache.get() calls.
  // Higher-role commands always do the full check (they may be blocked even
  // when admin-only mode is off, via their own enforcePermission gate).
  const cmdRole = (cfg?.['role'] as number | undefined) ?? Role.ANYONE;
  if (cmdRole === Role.ANYONE && sessionUserId && sessionId) {
    const sessOff =
      getCachedSessionAdminOnly(sessionUserId, platform, sessionId) === false;
    const threadOff =
      !threadID ||
      getCachedThreadAdminBox(sessionUserId, platform, sessionId, threadID) ===
        false;
    if (sessOff && threadOff) {
      await next();
      return;
    }
  }

  // ── Session-wide admin-only ─────────────────────────────────────────────
  // Read the setting first — admin status checks only happen when the feature
  // is actually enabled so public commands pay no auth-lookup cost here.
  // db.bot is already scoped to (userId:platform:sessionId) — no outer sessionUserId guard needed
  try {
    const botColl = ctx.db.bot;
    if (await botColl.isCollectionExist('session_settings')) {
      const h = await botColl.getCollection('session_settings');
      // Read the entire settings object once — avoids three separate readAll() cache lookups
      // that each traverse getBotSessionData() → lruCache.get() independently.
      const settings = await h.getAll();
      const enabled = settings['adminOnlyEnabled'] as boolean | null;
      // Populate the LRU flag so subsequent Role.ANYONE commands can fast-path skip.
      // setCachedSessionAdminOnly is a no-op when value is undefined.
      if (enabled !== null && enabled !== undefined && sessionUserId && sessionId) {
        setCachedSessionAdminOnly(sessionUserId, platform, sessionId, enabled === true);
      }

      if (enabled === true) {
        // Admin-only mode is on — now resolve caller's privilege level.
        // Both checks go through the request-scoped cache so if enforcePermission
        // or enforceNotBanned already resolved them they are instant Map lookups.
        const isSysAdmin = senderID
          ? await cachedIsSystemAdmin(ctx, senderID)
          : false;
        if (isSysAdmin) {
          // System admins bypass both gates unconditionally — skip thread check too.
          await next();
          return;
        }

        const isAdmin =
          senderID && sessionUserId && sessionId
            ? await cachedIsBotAdmin(ctx, sessionUserId, platform, sessionId, senderID)
            : false;

        if (!isAdmin) {
          const ignoreList =
            (settings['adminOnlyIgnoreList'] as string[] | null) ?? [];
          if (!ignoreList.includes(cmdName)) {
            const hideNoti = settings['adminOnlyHideNoti'] as boolean | null;
            if (hideNoti !== true) {
              const key = `adminonly_noti:${sessionUserId}:${platform}:${sessionId}:${senderID}`;
              if (cooldownStore.check(key, now) === null) {
                await ctx.chat.replyMessage({
                  message:
                    '🚫 The bot is currently in admin-only mode. Only bot admins may use commands.',
                });
                cooldownStore.record(key, now, 15000);
              }
            }
            return; // halt — handler never runs
          }
        }
      }
    } else if (sessionUserId && sessionId) {
      // Collection absent → admin-only definitively off; cache so future
      // Role.ANYONE commands skip this block without isCollectionExist call.
      setCachedSessionAdminOnly(sessionUserId, platform, sessionId, false);
    }
  } catch {
    // fail-open — DB outage must not lock out the entire session
  }

  // ── Per-thread admin-only ───────────────────────────────────────────────
  if (threadID) {
    try {
      const threadColl = ctx.db.threads.collection(threadID);
      if (await threadColl.isCollectionExist('adminbox_settings')) {
        const h = await threadColl.getCollection('adminbox_settings');
        // Read the entire settings object once — avoids three separate readAll() cache lookups
        // that each traverse getThreadSessionData() → lruCache.get() independently.
        const settings = await h.getAll();
        const enabled = settings['enabled'] as boolean | null;
        // Populate the LRU flag for the fast-path.
        if (enabled !== null && enabled !== undefined && sessionUserId && sessionId) {
          setCachedThreadAdminBox(sessionUserId, platform, sessionId, threadID, enabled === true);
        }

        if (enabled === true) {
          const ignoreList = (settings['ignoreList'] as string[] | null) ?? [];
          if (!ignoreList.includes(cmdName)) {
            // Per-thread admin-only is on — resolve caller's privilege level.
            // isSystemAdmin is checked first; a true result bypasses the thread
            // check entirely (same as the session-wide gate above).
            // Both checks use the request-scoped cache for instant re-use.
            const isSysAdmin = senderID
              ? await cachedIsSystemAdmin(ctx, senderID)
              : false;

            let allowed = isSysAdmin;
            if (!allowed && senderID && sessionUserId && sessionId) {
              allowed = await cachedIsBotAdmin(ctx, sessionUserId, platform, sessionId, senderID);
            }
            if (!allowed && senderID) {
              allowed = await cachedIsThreadAdmin(ctx, threadID, senderID);
            }
            if (!allowed) {
              const hideNoti = settings['hideNoti'] as boolean | null;
              if (hideNoti !== true) {
                const key = `adminbox_noti:${sessionUserId}:${platform}:${sessionId}:${threadID}:${senderID}`;
                if (cooldownStore.check(key, now) === null) {
                  await ctx.chat.replyMessage({
                    message:
                      '🚫 Only group admins can use the bot in this thread.',
                  });
                  cooldownStore.record(key, now, 15000);
                }
              }
              return; // halt — handler never runs
            }
          }
        }
      } else if (sessionUserId && sessionId) {
        // Collection absent → adminbox definitively off for this thread; cache it.
        setCachedThreadAdminBox(sessionUserId, platform, sessionId, threadID, false);
      }
    } catch {
      // fail-open — DB outage must not lock out the entire thread
    }
  }

  await next();
};

// ── Ban Enforcement ───────────────────────────────────────────────────────────

/**
 * Silently drops commands from banned users or threads — no error reply is sent
 * so banned actors cannot probe for their ban status. Runs FIRST in the onCommand
 * chain so no cooldown window is consumed and no option parsing is wasted on a
 * rejected invocation.
 *
 * Fail-open: isUserBanned / isThreadBanned return false on any DB error so a
 * temporary outage never locks out legitimate users.
 *
 * All auth/ban lookups use the request-scoped cache so values resolved here are
 * free hits for enforceAdminOnly / enforcePermission later in the same chain.
 */
export const enforceNotBanned: MiddlewareFn<OnCommandCtx> = async function (
  ctx,
  next,
): Promise<void> {
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;

  // Without session identity we cannot resolve ban records; fail-open and proceed
  if (!sessionUserId || !sessionId) {
    await next();
    return;
  }

  const senderID = (ctx.event['senderID'] ??
    ctx.event['userID'] ??
    '') as string;
  const threadID = (ctx.event['threadID'] ?? '') as string;
  const now = Date.now();

  // Bypass ban checks for bot admins so they retain full command control
  // even if they or the thread they are operating within is currently banned.
  if (senderID) {
    const isAdmin = await cachedIsBotAdmin(
      ctx,
      sessionUserId,
      platform,
      sessionId,
      senderID,
    );
    // System admins carry global authority equivalent to bot admin for ban bypass purposes —
    // only checked when isAdmin is false to avoid an unnecessary DB call when already allowed.
    const isSysAdmin = isAdmin
      ? false
      : await cachedIsSystemAdmin(ctx, senderID);
    if (isAdmin || isSysAdmin) {
      await next();
      return;
    }
  }

  // Both ban checks hit independent DB tables — run them in parallel to eliminate
  // one full DB round-trip from every non-admin command invocation.
  // Fallback to false when the discriminator (senderID / threadID) is absent so
  // Promise.all sees a uniform element type without branching on the call site.
  const [userBanned, threadBanned] = await Promise.all([
    senderID
      ? cachedIsUserBanned(ctx, sessionUserId, platform, sessionId, senderID)
      : Promise.resolve(false),
    threadID
      ? cachedIsThreadBanned(ctx, sessionUserId, platform, sessionId, threadID)
      : Promise.resolve(false),
  ]);

  // Evaluate results sequentially — user ban takes priority (matches original guard order).
  if (userBanned) {
    const key = `ban_u:${sessionUserId}:${platform}:${sessionId}:${senderID}`;
    if (!cooldownStore.check(key, now)) {
      await ctx.chat.replyMessage({ message: 'you are unable to use bot' });
      cooldownStore.record(key, now, 15000);
    }
    return;
  }

  if (threadBanned) {
    const key = `ban_t:${sessionUserId}:${platform}:${sessionId}:${threadID}`;
    if (!cooldownStore.check(key, now)) {
      await ctx.chat.replyMessage({ message: 'This thread unable to use bot' });
      cooldownStore.record(key, now, 15000);
    }
    return;
  }

  await next();
};
