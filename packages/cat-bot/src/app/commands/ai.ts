import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { runAgent, AgentRateLimitError } from '@/engine/agent/agent.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { getBotNickname } from '@/engine/repos/session.repo.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { isBotAdmin, isBotPremium } from '@/engine/repos/credentials.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { getUserGroqApiKey } from '@/engine/repos/groq-key.repo.js';
import { reactOnSuccess } from '@/engine/lib/react-on-success.lib.js';
import { cooldownStore } from '@/engine/lib/cooldown.lib.js';
import { createCurrenciesContext } from '@/engine/lib/currencies.lib.js';
import { getPayment } from '@/engine/types/module-meta.types.js';
import { withThinkingIndicator } from '@/engine/lib/thinking-indicator.lib.js';
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
  payment: 10,
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

// ── Per-user Groq key gate ───────────────────────────────────────────────────
// AI requires the requesting account to have configured its own Groq API key
// (Dashboard → Settings). When the key is missing, reply with a friendly notice
// and abort — this is the "AI features stay disabled until a valid key exists"
// guarantee, applied identically to the /ai command and the passive onChat path.
const NO_GROQ_KEY_MESSAGE =
  '🤖 **AI is disabled.** No Groq API key is configured for this account.\n' +
  'Add your key in **Dashboard → Settings** to enable AI features.';

const GROQ_RATE_LIMIT_MESSAGE =
  '⏳ **The AI is temporarily unavailable** — the Groq API key for this account ' +
  'has reached its rate limit.\n' +
  'Please try again in a few minutes.';

/**
 * Pure key read — no side effects. Used by the parallel gate resolution in
 * onChat so the key lookup overlaps the admin/payment gate reads instead of
 * adding a serial DB round-trip. Fail-closed: null on error or no key.
 */
async function resolveGroqKey(ctx: AppCtx): Promise<string | null> {
  const sessionUserId = ctx.native.userId ?? '';
  if (!sessionUserId) return null;
  try {
    return await getUserGroqApiKey(sessionUserId);
  } catch {
    // Fail-closed — a DB error must not let the agent run keyless
    return null;
  }
}

async function resolveGroqKeyOrWarn(ctx: AppCtx): Promise<string | null> {
  const apiKey = await resolveGroqKey(ctx);
  if (!apiKey) {
    await ctx.chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: NO_GROQ_KEY_MESSAGE,
    });
    return null;
  }
  return apiKey;
}

// ── Payment eligibility (onChat path only) ───────────────────────────────────
// Mirrors enforcePayment in the command middleware chain, which onChat bypasses.
// This is the PURE READ phase — it resolves the caller's privilege tier and
// balance with no side effect, so onChat can run it in parallel with the admin
// and key gates. The three privilege checks are independent and run concurrently
// instead of sequentially, keeping the pre-agent latency close to the original
// Cat-Bot's (which had no payment gate at all).
interface PaymentEligibility {
  bypass: boolean;
  balance: number;
  currencies: ReturnType<typeof createCurrenciesContext>;
}

async function resolvePaymentEligibility(
  ctx: AppCtx,
  senderID: string,
): Promise<PaymentEligibility> {
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;

  const [isSysAdmin, isAdmin, isPremiumUser] = await Promise.all([
    isSystemAdmin(senderID),
    sessionUserId && sessionId
      ? isBotAdmin(sessionUserId, platform, sessionId, senderID)
      : Promise.resolve(false),
    sessionUserId && sessionId
      ? isBotPremium(sessionUserId, platform, sessionId, senderID)
      : Promise.resolve(false),
  ]);

  const bypass = isSysAdmin || isAdmin || isPremiumUser;
  const currencies = createCurrenciesContext(sessionUserId, platform, sessionId);
  // Admins/premium bypass the gate entirely — no balance read needed (matches
  // the sequential version's short-circuit).
  if (bypass) return { bypass: true, balance: 0, currencies };
  const balance = await currencies.getMoney(senderID);
  return { bypass: false, balance, currencies };
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

  const threadID = (ctx.event['threadID'] ?? '') as string;

  // Per-user Groq key gate — reply with a notice and abort when the account has
  // no key configured (AI features stay disabled until a valid key is provided).
  const groqApiKey = await resolveGroqKeyOrWarn(ctx);
  if (!groqApiKey) return;

  try {
    const result = await withThinkingIndicator(ctx, threadID, () =>
      runAgent(prompt, ctx, nickname, userName, null, groqApiKey),
    );
    if (result) {
      await ctx.chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: result,
      });
    }
  } catch (err) {
    if (err instanceof AgentRateLimitError) {
      await ctx.chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: GROQ_RATE_LIMIT_MESSAGE,
      });
      return;
    }
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
    await withThinkingIndicator(ctx, threadID, async () => {
      // ── Parallel gate reads ───────────────────────────────────────────────
      // Admin restriction, payment eligibility, and Groq key resolution are all
      // independent reads. Resolving them concurrently — instead of serially —
      // collapses the pre-agent chain to ~max(gate) latency instead of their
      // sum, matching the original Cat-Bot's time-to-first-LLM-call while still
      // enforcing every gate. Side effects (notices, the charge) are applied
      // below in the original priority order so observable behaviour is unchanged.
      const paymentMeta = getPayment(meta as unknown as Record<string, unknown>);
      const needsPayment =
        senderID !== '' && typeof paymentMeta === 'number' && paymentMeta > 0;

      const [blockResult, apiKey, payment] = await Promise.all([
        isBlockedByAdminRestrictions(ctx, senderID, threadID).catch(() => null),
        resolveGroqKey(ctx),
        needsPayment
          ? resolvePaymentEligibility(ctx, senderID).catch(() => null)
          : Promise.resolve(null),
      ]);

      // ── Admin restriction gate (side effects) ─────────────────────────────
      // Must mirror enforceAdminOnly because onChat bypasses the command
      // middleware chain.
      if (blockResult?.blocked) {
        if (!blockResult.hideNoti) {
          // Rate-limit the notification to once per 15 s so a chatty user
          // doesn't flood the thread with rejection messages.
          const sessionUserId = ctx.native.userId ?? '';
          const sessionId     = ctx.native.sessionId ?? '';
          const platform      = ctx.native.platform;
          const now           = Date.now();

          const noticeKey =
            blockResult.reason === 'adminonly'
              ? `ai_adminonly_noti:${sessionUserId}:${platform}:${sessionId}:${senderID}`
              : `ai_adminbox_noti:${sessionUserId}:${platform}:${sessionId}:${threadID}:${senderID}`;

          if (cooldownStore.check(noticeKey, now) === null) {
            const noticeMsg =
              blockResult.reason === 'adminonly'
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

      // ── Payment gate (side effects) ───────────────────────────────────────
      // Mirrors enforcePayment in the command middleware chain, which onChat
      // bypasses. Charges the user unless they are a system admin, bot admin,
      // or premium (unlimited access) user. Fail-open on DB error (payment ===
      // null) so a storage hiccup never blocks the AI — identical to the
      // previous try/catch semantics.
      if (needsPayment && payment && !payment.bypass) {
        try {
          const amount = paymentMeta as number;
          if (payment.balance < amount) {
            const sessionUserId = ctx.native.userId ?? '';
            const sessionId = ctx.native.sessionId ?? '';
            const platform = ctx.native.platform;
            const noticeKey = `ai_payment_noti:${sessionUserId}:${platform}:${sessionId}:${senderID}`;
            if (cooldownStore.check(noticeKey, Date.now()) === null) {
              await ctx.chat.replyMessage({
                style: MessageStyle.MARKDOWN,
                message: `💳 **Insufficient balance to use this command.**\nRequired: **$${amount.toLocaleString()}**\nYour balance: **$${payment.balance.toLocaleString()}**`,
              });
              cooldownStore.record(noticeKey, Date.now(), 15_000);
            }
            return; // Abort — insufficient balance
          }
          await payment.currencies.decreaseMoney({
            user_id: senderID,
            money: amount,
          });
        } catch {
          // Fail-open — a DB hiccup must never block the AI from responding.
        }
      }

      // ── Per-user Groq key gate ─────────────────────────────────────────
      // Resolve the account's own key; when absent, reply with a notice and
      // abort so AI never runs keyless (or with another user's key).
      if (!apiKey) {
        await ctx.chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: NO_GROQ_KEY_MESSAGE,
        });
        return;
      }

      // ── Agent invocation ─────────────────────────────────────────────────
      const result = await runAgent(
        message,
        ctx,
        nickname,
        userName,
        undefined,
        apiKey,
      );
      if (result) {
        await ctx.chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: result,
        });

        // AI replied successfully — mirror the shared success-reaction contract:
        // react to the triggering message with the session's dynamic emoji, and
        // never let a reaction failure surface as an AI error (best-effort).
        await reactOnSuccess(ctx, ctx.event);
      }
    });
  } catch (err) {
    if (err instanceof AgentRateLimitError) {
      // The passive nickname path hides agent errors unless a tool already
      // replied — surface the rate limit explicitly so the user isn't left
      // with silence (cooldown-limited to prevent group flooding).
      const sessionUserId = ctx.native.userId ?? '';
      const sessionId = ctx.native.sessionId ?? '';
      const platform = ctx.native.platform;
      const noticeKey = `ai_rate_limit_noti:${sessionUserId}:${platform}:${sessionId}:${senderID}`;
      if (cooldownStore.check(noticeKey, Date.now()) === null) {
        await ctx.chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: GROQ_RATE_LIMIT_MESSAGE,
        });
        cooldownStore.record(noticeKey, Date.now(), 15_000);
      }
      return;
    }
    ctx.logger.error('[ai.ts] onChat agent execution failed', { error: err });
    // Generic agent failure (transient Groq/network error, tool crash, etc.) — the
    // user would otherwise get total silence and assume the bot is ignoring them.
    // Surface a brief, rate-limited error notice using the same pattern as the
    // rate-limit notice above.
    const sessionUserId = ctx.native.userId ?? '';
    const sessionId = ctx.native.sessionId ?? '';
    const platform = ctx.native.platform;
    const noticeKey = `ai_error_noti:${sessionUserId}:${platform}:${sessionId}:${senderID}`;
    if (cooldownStore.check(noticeKey, Date.now()) === null) {
      await ctx.chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '🤖 **The AI assistant hit an unexpected error and could not complete your request.**\nPlease try again in a moment.',
      });
      cooldownStore.record(noticeKey, Date.now(), 15_000);
    }
  }
};