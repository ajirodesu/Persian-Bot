import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Groq from 'groq-sdk';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { getBotNickname } from '@/engine/repos/session.repo.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { cooldownStore } from '@/engine/lib/cooldown.lib.js';
import { withThinkingIndicator } from '@/engine/lib/thinking-indicator.lib.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { env } from '@/engine/config/env.config.js';
import {
  getCachedSessionAdminOnly,
  setCachedSessionAdminOnly,
  getCachedThreadAdminBox,
  setCachedThreadAdminBox,
} from '@/engine/lib/admin-only-state.lib.js';

// ── Load Lans system prompt ───────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LANS_SYSTEM_PROMPT_TEMPLATE = fs.readFileSync(
  path.join(__dirname, '../../../agent/lans_system_prompt.md'),
  'utf-8',
);

// ── Groq singleton for Lans ───────────────────────────────────────────────────
let _groqInstance: Groq | null = null;
function getGroq(): Groq {
  if (!_groqInstance) {
    const key = env.GROQ_API_KEY;
    if (!key) throw new Error('GROQ_API_KEY is not set. Lans is unavailable.');
    _groqInstance = new Groq({ apiKey: key });
  }
  return _groqInstance;
}

// ── Reply state key ───────────────────────────────────────────────────────────
const STATE = {
  lans_awaiting_reply: 'lans_awaiting_reply',
} as const;

// ── Conversation history constants ────────────────────────────────────────────
const LANS_MODEL = 'openai/gpt-oss-120b';
/**
 * Maximum messages (user + assistant) retained per user.
 * 20 messages = 10 full exchanges. Oldest are trimmed from the front.
 */
const MAX_HISTORY_MESSAGES = 20;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ── Conversation history helpers ──────────────────────────────────────────────

async function getLansHistory(ctx: AppCtx, senderID: string): Promise<ChatMessage[]> {
  try {
    // Skip the isCollectionExist pre-check — if the collection is absent, getCollection
    // will throw and the outer catch returns [] with a single DB round-trip instead of two.
    const userColl = ctx.db.users.collection(senderID);
    const h = await userColl.getCollection('lans_history');
    const stored = (await h.get('messages')) as ChatMessage[] | null;
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

async function saveLansHistory(
  ctx: AppCtx,
  senderID: string,
  messages: ChatMessage[],
): Promise<void> {
  try {
    const userColl = ctx.db.users.collection(senderID);
    let h: Awaited<ReturnType<typeof userColl.getCollection>>;
    try {
      // Happy path (collection already exists after the first conversation): 1 DB call.
      h = await userColl.getCollection('lans_history');
    } catch {
      // First time this user ever talks to Lans — create then fetch.
      await userColl.createCollection('lans_history');
      h = await userColl.getCollection('lans_history');
    }
    await h.set('messages', messages);
  } catch {
    // Fail silently — history write must never break the conversation
  }
}

async function resetLansHistory(ctx: AppCtx, senderID: string): Promise<void> {
  try {
    // If the collection doesn't exist there is nothing to reset — getCollection will throw
    // and the catch silently returns, avoiding an extra isCollectionExist round-trip.
    const userColl = ctx.db.users.collection(senderID);
    const h = await userColl.getCollection('lans_history');
    await h.set('messages', []);
  } catch {
    // Collection absent or other transient error — nothing to reset
  }
}

// ── Lans conversation engine ──────────────────────────────────────────────────

async function runLansConversation(
  userInput: string,
  systemPrompt: string,
  history: ChatMessage[],
): Promise<string> {
  const groq = getGroq();
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userInput },
  ];
  const response = await groq.chat.completions.create({
    model: LANS_MODEL,
    messages,
  });
  return response.choices[0]?.message?.content?.trim() ?? '';
}

/**
 * Appends the latest exchange and trims the buffer to MAX_HISTORY_MESSAGES.
 */
function appendToHistory(
  history: ChatMessage[],
  userInput: string,
  assistantReply: string,
): ChatMessage[] {
  const updated: ChatMessage[] = [
    ...history,
    { role: 'user', content: userInput },
    { role: 'assistant', content: assistantReply },
  ];
  return updated.length > MAX_HISTORY_MESSAGES
    ? updated.slice(updated.length - MAX_HISTORY_MESSAGES)
    : updated;
}

// ── Command metadata ──────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'lans',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'System',
  description:
    'Chat with Lans, a compassionate AI companion. Remembers your conversation. Reply to any of Lans\'s messages to continue the chat. Use `/lans reset` to start fresh.',
  category: 'AI Chat',
  usage: '<message> | reset',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'message',
      description: 'Your message to Lans, or "reset" to clear conversation history',
      required: false,
    },
  ],
};

// ── Telegram @username mention stripper ───────────────────────────────────────
function stripTelegramMentions(message: string): string {
  return message.replace(/@\S+/g, ' ');
}

// ── Prefix → lans-invocation regex cache ─────────────────────────────────────
// `new RegExp(...)` compiles a regex object on every call. The prefix is the
// same for an entire session lifetime, so we cache one RegExp per unique prefix
// string rather than recompiling on every incoming message.
const prefixLansRegexCache = new Map<string, RegExp>();
function getPrefixLansRegex(prefix: string): RegExp {
  let re = prefixLansRegexCache.get(prefix);
  if (!re) {
    const escaped = prefix.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, String.raw`\// ── Telegram @username mention stripper ───────────────────────────────────────
function stripTelegramMentions(message: string): string {
  return message.replace(/@\S+/g, ' ');
}`);
    re = new RegExp(String.raw`^${escaped}lans(\s|$)`, 'i');
    prefixLansRegexCache.set(prefix, re);
  }
  return re;
}

// ── Admin restriction guard ───────────────────────────────────────────────────
async function isBlockedByAdminRestrictions(
  ctx: AppCtx,
  senderID: string,
  threadID: string,
): Promise<{ blocked: boolean; reason: 'adminonly' | 'adminbox' | null; hideNoti: boolean }> {
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId     = ctx.native.sessionId ?? '';
  const platform      = ctx.native.platform;

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

  try {
    const botColl = ctx.db.bot;
    if (await botColl.isCollectionExist('session_settings')) {
      const h        = await botColl.getCollection('session_settings');
      const settings = await h.getAll();
      const enabled  = settings['adminOnlyEnabled'] as boolean | null;
      if (enabled !== null && enabled !== undefined && sessionUserId && sessionId) {
        setCachedSessionAdminOnly(sessionUserId, platform, sessionId, enabled === true);
      }
      if (enabled === true) {
        const ignoreList = (settings['adminOnlyIgnoreList'] as string[] | null) ?? [];
        if (!ignoreList.includes('lans')) {
          if (senderID && (await isSystemAdmin(senderID))) {
            // System admins bypass unconditionally
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
      setCachedSessionAdminOnly(sessionUserId, platform, sessionId, false);
    }
  } catch {
    // Fail-open
  }

  if (threadID) {
    try {
      const threadColl = ctx.db.threads.collection(threadID);
      if (await threadColl.isCollectionExist('adminbox_settings')) {
        const h        = await threadColl.getCollection('adminbox_settings');
        const settings = await h.getAll();
        const enabled  = settings['enabled'] as boolean | null;
        if (enabled !== null && enabled !== undefined && sessionUserId && sessionId) {
          setCachedThreadAdminBox(sessionUserId, platform, sessionId, threadID, enabled === true);
        }
        if (enabled === true) {
          const ignoreList = (settings['ignoreList'] as string[] | null) ?? [];
          if (!ignoreList.includes('lans')) {
            const isThreadAdm =
              senderID ? await isThreadAdmin(threadID, senderID) : false;
            if (!isThreadAdm) {
              const hideNoti = (settings['hideNoti'] as boolean | null) === true;
              return { blocked: true, reason: 'adminbox', hideNoti };
            }
          }
        }
      } else if (sessionUserId && sessionId) {
        setCachedThreadAdminBox(sessionUserId, platform, sessionId, threadID, false);
      }
    } catch {
      // Fail-open
    }
  }

  return { blocked: false, reason: null, hideNoti: false };
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildLansSystemPrompt(userName: string | null, botNickname: string | null): string {
  return LANS_SYSTEM_PROMPT_TEMPLATE
    .replace(/\{\{USER_NAME\}\}/g, userName ?? 'User')
    .replace(/\{\{BOT_NAME\}\}/g, botNickname ?? 'Cat-Bot');
}

// ── Nickname / username resolver ──────────────────────────────────────────────

async function resolveNicknameAndUser(
  ctx: AppCtx,
  senderID: string,
): Promise<{ nickname: string | null; userName: string | null }> {
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
  return { nickname, userName };
}

// ── Reset helper ──────────────────────────────────────────────────────────────

async function handleReset(ctx: AppCtx, senderID: string): Promise<void> {
  if (senderID) await resetLansHistory(ctx, senderID);
  await ctx.chat.replyMessage({
    style: MessageStyle.TEXT,
    message: "✅ Done! Your Lans conversation has been reset. Let's start fresh whenever you're ready.",
  });
}

// ── Core: run conversation and send reply, returning the bot message ID ───────
//
// Used by onCommand, onChat, and onReply so the typing-indicator + history
// + state-registration logic stays in one place.

async function runAndReply(
  userInput: string,
  ctx: AppCtx,
  senderID: string,
): Promise<string | undefined> {
  // Fetch nickname, userName, and conversation history concurrently — none depends on the others.
  const [{ nickname, userName }, history] = await Promise.all([
    resolveNicknameAndUser(ctx, senderID),
    senderID ? getLansHistory(ctx, senderID) : Promise.resolve([] as ChatMessage[]),
  ]);

  const systemPrompt = buildLansSystemPrompt(userName, nickname);
  const reply = await runLansConversation(userInput, systemPrompt, history);
  if (!reply) return undefined;

  // Sending the reply and persisting history are independent — run them concurrently.
  // The message send result (msgID) is needed by the caller to register reply state;
  // the history save has no return value the caller cares about.
  const [msgID] = await Promise.all([
    ctx.chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: reply,
    }),
    senderID
      ? saveLansHistory(ctx, senderID, appendToHistory(history, userInput, reply))
      : Promise.resolve(undefined),
  ]);

  return msgID != null ? String(msgID) : undefined;
}

// ── Register onReply state on a bot message ID ────────────────────────────────

function registerReplyState(ctx: AppCtx, botMsgID: string, senderID: string): void {
  ctx.state.create({
    id: ctx.state.generateID({ id: botMsgID }),
    state: STATE.lans_awaiting_reply,
    context: { senderID },
  });
}

// ── onCommand ─────────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const rawInput = ctx.args.join(' ').trim();

  const senderID = (ctx.event['senderID'] ??
    ctx.event['userID'] ??
    '') as string;

  // ── Reset shortcut ─────────────────────────────────────────────────────────
  if (rawInput.toLowerCase() === 'reset') {
    await handleReset(ctx, senderID);
    return;
  }

  if (!rawInput) {
    await ctx.usage();
    return;
  }

  const threadID = (ctx.event['threadID'] ?? '') as string;

  try {
    const botMsgID = await withThinkingIndicator<string | undefined>(
      ctx,
      threadID,
      () => runAndReply(rawInput, ctx, senderID),
    );
    if (botMsgID && senderID) {
      registerReplyState(ctx, botMsgID, senderID);
    }
  } catch (err) {
    await ctx.chat.replyMessage({
      style: MessageStyle.TEXT,
      message: `Lans Error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
};

// ── onChat ────────────────────────────────────────────────────────────────────

export const onChat = async (ctx: AppCtx): Promise<void> => {
  const message = ((ctx.event['message'] as string | undefined) || '').trim();
  if (!message) return;

  // Skip /lans command invocations — the command dispatcher already handles them.
  const prefix = ctx.prefix || '/';
  if (getPrefixLansRegex(prefix).test(message)) return;

  const senderID = (ctx.event['senderID'] ??
    ctx.event['userID'] ??
    '') as string;
  const threadID = (ctx.event['threadID'] ?? '') as string;

  const matchSource =
    ctx.native.platform === Platforms.Telegram
      ? stripTelegramMentions(message)
      : message;

  // If the user is replying directly to one of Lans's messages, continue
  // the conversation without requiring them to say her name again.
  const messageReply = ctx.event['messageReply'] as
    | Record<string, unknown>
    | null
    | undefined;
  const repliedToSenderID = messageReply?.['senderID'] as string | undefined;
  let isReplyToBot = false;
  if (repliedToSenderID) {
    try {
      const botID = await ctx.bot.getID();
      isReplyToBot = !!botID && repliedToSenderID === botID;
    } catch {
      // Fail-open: if we can't resolve the bot ID, fall through to name check.
    }
  }

  if (!isReplyToBot && !/\blans\b/i.test(matchSource)) return;

  // ── Reset intent ───────────────────────────────────────────────────────────
  if (/^\s*lans\s+reset\s*[!.]?\s*$/i.test(matchSource)) {
    await handleReset(ctx, senderID);
    return;
  }

  // ── Typing indicator + admin gate + conversation ───────────────────────────
  try {
    const botMsgID = await withThinkingIndicator<string | undefined>(
      ctx,
      threadID,
      async () => {
        // Admin restriction gate
        try {
          const { blocked, reason, hideNoti } = await isBlockedByAdminRestrictions(
            ctx,
            senderID,
            threadID,
          );

          if (blocked) {
            if (!hideNoti) {
              const sessionUserId = ctx.native.userId ?? '';
              const sessionId     = ctx.native.sessionId ?? '';
              const platform      = ctx.native.platform;
              const now           = Date.now();

              const noticeKey =
                reason === 'adminonly'
                  ? `lans_adminonly_noti:${sessionUserId}:${platform}:${sessionId}:${senderID}`
                  : `lans_adminbox_noti:${sessionUserId}:${platform}:${sessionId}:${threadID}:${senderID}`;

              if (cooldownStore.check(noticeKey, now) === null) {
                const noticeMsg =
                  reason === 'adminonly'
                    ? `🤖 Sorry, Lans is currently **restricted to bot admins only**.\nIf you believe this is a mistake, please contact a bot admin.`
                    : `🤖 Sorry, Lans is currently **restricted to group admins** in this thread.\nIf you believe this is a mistake, please contact a group admin.`;

                await ctx.chat.replyMessage({
                  style: MessageStyle.MARKDOWN,
                  message: noticeMsg,
                });
                cooldownStore.record(noticeKey, now, 15_000);
              }
            }
            return undefined;
          }
        } catch {
          // Fail-open
        }

        return runAndReply(message, ctx, senderID);
      },
    );

    if (botMsgID && senderID) {
      registerReplyState(ctx, botMsgID, senderID);
    }
  } catch (err) {
    ctx.logger.error('[lans.ts] onChat conversation failed', { error: err });
  }
};

// ── onReply ───────────────────────────────────────────────────────────────────
//
// Triggered when a user replies directly to one of Lans's messages.
// The state chain is kept alive by re-registering on the new bot message ID
// after every reply, so the back-and-forth can continue indefinitely.

export const onReply = {
  [STATE.lans_awaiting_reply]: async (ctx: AppCtx): Promise<void> => {
    const userInput = ((ctx.event['message'] as string | undefined) || '').trim();
    const senderID  = (ctx.session.context['senderID'] as string | undefined) ?? '';
    const threadID  = (ctx.event['threadID'] ?? '') as string;

    // Delete the current state immediately — prevents double-firing if the
    // same bot message is quoted a second time before we re-register.
    ctx.state.delete(ctx.session.id);

    if (!userInput || !senderID) return;

    // ── Reset intent via reply ─────────────────────────────────────────────
    if (/^\s*reset\s*[!.]?\s*$/i.test(userInput)) {
      await handleReset(ctx, senderID);
      return;
    }

    try {
      const botMsgID = await withThinkingIndicator<string | undefined>(
        ctx,
        threadID,
        async () => runAndReply(userInput, ctx, senderID),
      );

      // Re-register state on the new bot message to keep the chain alive.
      if (botMsgID && senderID) {
        registerReplyState(ctx, botMsgID, senderID);
      }
    } catch (err) {
      ctx.logger.error('[lans.ts] onReply conversation failed', { error: err });
    }
  },
};