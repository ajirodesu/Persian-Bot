import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { runAgent } from '@/engine/agent/agent.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { getBotNickname } from '@/engine/repos/session.repo.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { cooldownStore } from '@/engine/lib/cooldown.lib.js';
import { withTypingIndicator } from '@/engine/lib/typing-indicator.lib.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import {
  getCachedSessionAdminOnly,
  setCachedSessionAdminOnly,
  getCachedThreadAdminBox,
  setCachedThreadAdminBox,
} from '@/engine/lib/admin-only-state.lib.js';

export const meta: CommandMeta = {
  name: 'ai',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'System',
  description:
    'Interact with the AI assistant. It can chat and execute commands on your behalf.',
  category: 'AI Chat',
  usage: '<prompt>',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'prompt',
      description: 'Your prompt',
      required: false,
    },
  ],
};

// ── Admin-only guard (for onChat path only) ───────────────────────────────────
//
// The /ai command already passes through enforceAdminOnly middleware in the
// command pipeline, so onCommand is already gated. However, the onChat passive
// listener is invoked outside the command middleware chain and therefore needs
// its own equivalent check.
//
// Returns true  → caller should ABORT (user is restricted).
// Returns false → caller may proceed with the agent.
//
// Suppression logic mirrors enforceAdminOnly in on-command.middleware.ts:
//   • Rate-limited to one notification per 15 s per user per mode (prevents flooding).
//   • hideNoti / adminOnlyHideNoti → completely silent rejection.
//   • System admin > bot admin > thread admin bypass (most → least privileged).

// ── Telegram @username vs. nickname conflict guard ─────────────────────────
//
// The nickname trigger below does a plain substring match against the raw message
// text. On Telegram, "@BotUsername" mentions — either attached to a command
// ("/help@ShiaBot") or standalone ("@ShiaBot what's up") — are addressing syntax,
// not the nickname feature. When a bot's nickname happens to be identical or
// similar to its Telegram @username (a common setup), that substring match would
// otherwise misfire alongside (or instead of) the actual command/mention handling.
//
// Stripping every "@token" before the nickname check keeps the two features
// independent: "/help@ShiaBot" is routed purely through command dispatch, and a
// bare nickname mention elsewhere in the message (without "@") still triggers the
// AI as intended. Scoped to Telegram only, per platform.
function stripTelegramMentions(message: string): string {
  return message.replace(/@\S+/g, ' ');
}

async function isBlockedByAdminRestrictions(
  ctx: AppCtx,
  senderID: string,
  threadID: string,
): Promise<{ blocked: boolean; reason: 'adminonly' | 'adminbox' | null; hideNoti: boolean }> {
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId     = ctx.native.sessionId ?? '';
  const platform      = ctx.native.platform;

  // ── Fast-path: skip all async DB reads when both modes are known to be off ──
  // The LRU flags are populated by enforceAdminOnly (command path) and by the
  // settings read below (onChat path). On the first onChat invocation per session
  // the flags are absent (undefined) so we fall through to the full check.
  if (sessionUserId && sessionId) {
    const sessOff =
      getCachedSessionAdminOnly(sessionUserId, platform, sessionId) === false;
    const threadOff =
      !threadID ||
      getCachedThreadAdminBox(sessionUserId, platform, sessionId, threadID) === false;
    if (sessOff && threadOff) {
      return { blocked: false, reason: null, hideNoti: false };
    }
  }

  // ── 1. Session-wide admin-only (adminonly command) ─────────────────────────
  // Read settings FIRST — admin status checks are deferred until we confirm the
  // mode is on, so public-path calls pay no auth-lookup cost when it's disabled.
  try {
    const botColl = ctx.db.bot;
    if (await botColl.isCollectionExist('session_settings')) {
      const h        = await botColl.getCollection('session_settings');
      const settings = await h.getAll();
      const enabled  = settings['adminOnlyEnabled'] as boolean | null;
      // Populate the LRU flag for future fast-path skips.
      if (enabled !== null && enabled !== undefined && sessionUserId && sessionId) {
        setCachedSessionAdminOnly(sessionUserId, platform, sessionId, enabled === true);
      }

      if (enabled === true) {
        const ignoreList = (settings['adminOnlyIgnoreList'] as string[] | null) ?? [];
        // 'ai' is the canonical command name — honour per-command ignore list entries.
        if (!ignoreList.includes('ai')) {
          // Admin-only is on — now check if caller is privileged enough to bypass.
          if (senderID && (await isSystemAdmin(senderID))) {
            // System admins bypass both gates unconditionally.
          } else {
            const callerIsAdmin =
              senderID && sessionUserId && sessionId
                ? await isBotAdmin(sessionUserId, platform, sessionId, senderID)
                : false;
            if (!callerIsAdmin) {
              const hideNoti = (settings['adminOnlyHideNoti'] as boolean | null) === true;
              return { blocked: true, reason: 'adminonly', hideNoti };
            }
          }
        }
      }
    } else if (sessionUserId && sessionId) {
      // Collection absent → admin-only definitively off; cache it.
      setCachedSessionAdminOnly(sessionUserId, platform, sessionId, false);
    }
  } catch {
    // Fail-open — DB outage must not silently lock out the session
  }

  // ── 2. Per-thread admin-only (onlyadminbox command) ────────────────────────
  if (threadID) {
    try {
      const threadColl = ctx.db.threads.collection(threadID);
      if (await threadColl.isCollectionExist('adminbox_settings')) {
        const h        = await threadColl.getCollection('adminbox_settings');
        const settings = await h.getAll();
        const enabled  = settings['enabled'] as boolean | null;
        // Populate the LRU flag for future fast-path skips.
        if (enabled !== null && enabled !== undefined && sessionUserId && sessionId) {
          setCachedThreadAdminBox(sessionUserId, platform, sessionId, threadID, enabled === true);
        }

        if (enabled === true) {
          const ignoreList = (settings['ignoreList'] as string[] | null) ?? [];
          if (!ignoreList.includes('ai')) {
            // Thread admins are also exempt from onlyadminbox restrictions.
            const isThreadAdm =
              senderID ? await isThreadAdmin(threadID, senderID) : false;
            if (!isThreadAdm) {
              const hideNoti = (settings['hideNoti'] as boolean | null) === true;
              return { blocked: true, reason: 'adminbox', hideNoti };
            }
          }
        }
      } else if (sessionUserId && sessionId) {
        // Collection absent → adminbox definitively off for this thread; cache it.
        setCachedThreadAdminBox(sessionUserId, platform, sessionId, threadID, false);
      }
    } catch {
      // Fail-open
    }
  }

  return { blocked: false, reason: null, hideNoti: false };
}

/**
 * Handles explicit command invocation via prefix (e.g., `/ai I want some memes`).
 * Admin restriction enforcement is handled upstream by enforceAdminOnly middleware.
 */
export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const prompt = ctx.args.join(' ').trim();
  if (!prompt) {
    await ctx.usage();
    return;
  }

  // Resolve bot nickname and sender display name to inject into the agent's system prompt.
  const senderID = (ctx.event['senderID'] ??
    ctx.event['userID'] ??
    '') as string;
  const nickname =
    ctx.native.userId && ctx.native.sessionId
      ? await getBotNickname(
          ctx.native.userId as string,
          ctx.native.platform,
          ctx.native.sessionId as string,
        )
      : null;
  const userName = senderID ? await ctx.user.getName(senderID) : null;

  try {
    const result = await runAgent(prompt, ctx, nickname, userName);
    if (result) {
      await ctx.chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: result,
      });
    }
  } catch (err) {
    await ctx.chat.replyMessage({
      style: MessageStyle.TEXT,
      message: `AI Error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
};

/**
 * Passive middleware listener. Checks every incoming message.
 * If it matches the bot's name (e.g., "Hey Cat-Bot, do something"), triggers
 * the agent transparently — but ONLY when the user is not restricted by
 * adminonly or onlyadminbox modes.
 */
export const onChat = async (ctx: AppCtx): Promise<void> => {
  const message = ((ctx.event['message'] as string | undefined) || '').trim();
  if (!message) return;

  // Resolve IDs synchronously — no await needed.
  const senderID = (ctx.event['senderID'] ??
    ctx.event['userID'] ??
    '') as string;
  const threadID = (ctx.event['threadID'] ?? '') as string;

  // Fetch nickname and display name in parallel — both are needed for the
  // match check, and neither depends on the other.
  const [nickname, userName] = await Promise.all([
    ctx.native.userId && ctx.native.sessionId
      ? getBotNickname(
          ctx.native.userId as string,
          ctx.native.platform,
          ctx.native.sessionId as string,
        )
      : Promise.resolve(null),
    senderID ? ctx.user.getName(senderID) : Promise.resolve(null),
  ]);

  // webchatNickname is injected by the web chat room socket handler so the
  // user's custom bot nickname (stored client-side) triggers the AI without a
  // DB lookup.
  const webchatNickname = ctx.native['webchatNickname'] as string | null | undefined;
  const targetName = nickname || webchatNickname || 'Cat-Bot';

  // On Telegram, ignore "@..." mention tokens when checking for the nickname so
  // an @username mention (e.g. attached to a command like "/help@ShiaBot", or
  // typed standalone) never conflicts with a nickname that's identical or
  // similar to the bot's actual @username.  See stripTelegramMentions() above.
  const nicknameMatchSource =
    ctx.native.platform === Platforms.Telegram
      ? stripTelegramMentions(message)
      : message;

  if (!nicknameMatchSource.toLowerCase().includes(targetName.toLowerCase()))
    return;

  // ── Typing indicator + admin gate + agent ──────────────────────────────────
  // The typing indicator now wraps the admin check as well as the agent call.
  // Admin restriction reads can involve cold DB lookups on the first invocation
  // (the LRU cache is empty); wrapping them keeps the "bot is typing" signal
  // alive for the full processing window rather than starting it only after the
  // DB reads complete.
  try {
    await withTypingIndicator(ctx.api, threadID, async () => {
      // ── Admin restriction gate ───────────────────────────────────────────
      // Must mirror enforceAdminOnly because onChat bypasses the command
      // middleware chain.
      try {
        const { blocked, reason, hideNoti } = await isBlockedByAdminRestrictions(
          ctx,
          senderID,
          threadID,
        );

        if (blocked) {
          if (!hideNoti) {
            // Rate-limit the notification to once per 15 s so a chatty user
            // doesn't flood the thread with rejection messages.
            const sessionUserId = ctx.native.userId ?? '';
            const sessionId     = ctx.native.sessionId ?? '';
            const platform      = ctx.native.platform;
            const now           = Date.now();

            const noticeKey =
              reason === 'adminonly'
                ? `ai_adminonly_noti:${sessionUserId}:${platform}:${sessionId}:${senderID}`
                : `ai_adminbox_noti:${sessionUserId}:${platform}:${sessionId}:${threadID}:${senderID}`;

            if (cooldownStore.check(noticeKey, now) === null) {
              const noticeMsg =
                reason === 'adminonly'
                  ? `🤖 Sorry, the AI assistant is currently **restricted to bot admins only**.\nIf you believe this is a mistake, please contact a bot admin.`
                  : `🤖 Sorry, the AI assistant is currently **restricted to group admins** in this thread.\nIf you believe this is a mistake, please contact a group admin.`;

              await ctx.chat.replyMessage({
                style: MessageStyle.MARKDOWN,
                message: noticeMsg,
              });
              cooldownStore.record(noticeKey, now, 15_000);
            }
          }
          return; // Abort — do NOT run the agent
        }
      } catch {
        // Fail-open — a DB outage must not silently prevent the AI from responding
      }

      // ── Agent invocation ─────────────────────────────────────────────────
      const result = await runAgent(message, ctx, nickname, userName);
      if (result) {
        await ctx.chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: result,
        });
      }
    });
  } catch (err) {
    ctx.logger.error('[ai.ts] onChat agent execution failed', { error: err });
  }
};