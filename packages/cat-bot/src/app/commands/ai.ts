import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { runAgent } from '@/engine/agent/agent.js';
import { getBotNickname } from '@/engine/repos/session.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { cooldownStore } from '@/engine/lib/cooldown.lib.js';
import { getAiAgentSettings } from '@/engine/repos/ai-agent-config.repo.js';

/**
 * AI command — explicit `/ai <prompt>` plus passive bot-name invocation.
 *
 * Both paths funnel into the Cat-Bot-style agent subsystem
 * (`engine/agent/agent.ts`), which reasons via the separately hosted
 * Cactus Needle 3 service and executes through help → test_command →
 * send_result. Delivery is owned by send_result, so a non-empty return from
 * runAgent is only a fallback reply — bare empty string means "delivered".
 *
 * Security: identical rules for explicit and passive usage — system / bot /
 * thread admin hierarchy, session admin-only mode, per-thread adminbox, and
 * hidden-notification cooldowns are all respected. Passive replies never
 * bypass authorization.
 */

export const meta: CommandMeta = {
  name: 'ai',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'Persian-Bot',
  description: 'Chat with the AI assistant (Cactus Needle 3)',
  category: 'AI Chat',
  usage: '<prompt>',
  cooldown: 5,
  hasPrefix: true,
};

/** Passive trigger cooldown — one notice per user per window when blocked. */
const PASSIVE_NOTI_COOLDOWN_MS = 15 * 1000;

async function resolveNames(ctx: AppCtx): Promise<{
  nickname: string;
  userName: string;
}> {
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;
  let nickname = 'Persian-Bot';
  try {
    const stored = await getBotNickname(sessionUserId, platform, sessionId);
    if (stored) nickname = stored;
  } catch {
    /* fail-open — default name */
  }
  let userName = 'User';
  try {
    const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string;
    if (senderID) userName = await ctx.user.getName(senderID);
  } catch {
    /* fail-open */
  }
  return { nickname, userName };
}

/**
 * Passive/admin gate for AI replies. Returns a block reason, or null when
 * the AI may answer. Silent by design for onChat (passive observers never
 * send denial messages on their own).
 */
async function getPassiveBlockReason(ctx: AppCtx): Promise<string | null> {
  const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string;
  const threadID = (ctx.event['threadID'] ?? '') as string;
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;

  try {
    // System admins and bot admins always pass.
    if (senderID && (await isSystemAdmin(senderID))) return null;
    if (
      senderID &&
      sessionUserId &&
      sessionId &&
      (await isBotAdmin(sessionUserId, platform, sessionId, senderID))
    ) {
      return null;
    }

    // Session-wide admin-only mode.
    try {
      const botColl = ctx.db.bot;
      if (await botColl.isCollectionExist('session_settings')) {
        const h = await botColl.getCollection('session_settings');
        const settings = await h.getAll();
        if (settings['adminOnlyEnabled'] === true) {
          const ignoreList =
            (settings['adminOnlyIgnoreList'] as string[] | null) ?? [];
          if (!ignoreList.includes('ai')) return 'admin-only';
        }
      }
    } catch {
      /* fail-open */
    }

    // Per-thread adminbox.
    if (threadID) {
      try {
        const threadColl = ctx.db.threads.collection(threadID);
        if (await threadColl.isCollectionExist('adminbox_settings')) {
          const h = await threadColl.getCollection('adminbox_settings');
          const settings = await h.getAll();
          if (settings['enabled'] === true) {
            const ignoreList = (settings['ignoreList'] as string[] | null) ?? [];
            if (!ignoreList.includes('ai')) {
              let allowed = false;
              if (senderID) {
                allowed = await isThreadAdmin(threadID, senderID);
              }
              if (!allowed) return 'admin-only';
            }
          }
        }
      } catch {
        /* fail-open */
      }
    }
  } catch {
    return null; // fail-open — a DB outage must not kill passive AI
  }
  return null;
}

async function answerWithAgent(prompt: string, ctx: AppCtx): Promise<void> {
  const { nickname, userName } = await resolveNames(ctx);
  let result: string;
  try {
    result = await runAgent(prompt, ctx, nickname, userName);
  } catch (err) {
    await ctx.chat.replyMessage({
      message:
        'The AI is temporarily unavailable. Please try again later.',
    });
    ctx.logger.error('❌ [ai] runAgent threw', { error: err });
    return;
  }
  // Non-empty = fallback reply (send_result already delivered → returns '').
  if (result) {
    await ctx.chat.replyMessage({ message: result });
  }
}

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const prompt = ctx.args.join(' ').trim();
  if (!prompt) {
    await ctx.usage();
    return;
  }
  // Explicit usage honors AI availability messaging (no silent drop here).
  try {
    const settings = await getAiAgentSettings();
    if (!settings.enabled) {
      await ctx.chat.replyMessage({ message: 'The AI is currently disabled.' });
      return;
    }
  } catch {
    /* fail-open — let runAgent report the precise state */
  }
  await answerWithAgent(prompt, ctx);
};

export const onChat = async (ctx: AppCtx): Promise<void> => {
  const body = ((ctx.event['message'] ?? ctx.event['body'] ?? '') as string).trim();
  if (!body) return;
  // Never react to our own command invocations (handled by onCommand).
  const prefix = ctx.prefix ?? '/';
  if (body.startsWith(prefix)) return;

  const { nickname } = await resolveNames(ctx);
  const lowered = body.toLowerCase();
  const nameLower = nickname.toLowerCase();
  const mentioned =
    lowered.includes(nameLower) ||
    lowered.includes('persian-bot') ||
    lowered.includes('persianbot');
  if (!mentioned) return;

  const blocked = await getPassiveBlockReason(ctx);
  if (blocked) {
    // Hidden-notification discipline: at most one silent cooldown entry, no reply.
    const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? 'anon') as string;
    const key = `ai_passive_noti:${ctx.native.userId}:${ctx.native.platform}:${ctx.native.sessionId}:${senderID}`;
    if (cooldownStore.check(key, Date.now()) === null) {
      cooldownStore.record(key, Date.now(), PASSIVE_NOTI_COOLDOWN_MS);
    }
    return;
  }

  await answerWithAgent(body, ctx);
};
