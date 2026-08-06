/**
 * ai-chat.ts — Text-based AI chat command family (config-driven)
 *
 * Ports the `commands/ai/*` chat commands from the original nirwabot CommonJS
 * modules to Cat-Bot's TypeScript multi-command shape (same architecture as
 * morse.ts / youtube.ts / popcat-text.ts). One AI_CHAT_CONFIGS table declares
 * each provider's endpoint, params, and response parsing; a single shared
 * runAiChat() dispatches on that config.
 *
 * All commands share the same behaviour:
 *   User: /<cmd> <prompt>          — stateless one-shot reply
 *   User: /<cmd> reset             — clears the per-user conversation session
 *   User: /<cmd> (reply to text)   — uses the replied message as the prompt
 *   User: /<cmd> <prompt> + photo  — forwards the photo to vision-capable models
 *
 * ── Providers (apis.lib.ts registry) ──────────────────────────────────────
 *   alwayscodex  /api/ai/gpt4o-mini           → chatgpt   (JsonML,+image)
 *   alwayscodex  /api/ai/chatgpt-org          → claude / perplexity / qwen
 *   alwayscodex  /api/ai/deepseek-flash       → deepseek
 *   alwayscodex  /api/ai/{gemini,venice}      → stateless chats
 *   nexray       /ai/copilot                  → copilot
 *
 * All user-facing text is in English (the original captions were Indonesian).
 */

import axios from 'axios';
import { randomUUID } from 'node:crypto';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { RoleLevel } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { AttachmentType } from '@/engine/adapters/models/enums/index.js';

// ── Shared session store (per-user, future `ai_session` collection) ──────────
//
// The original code persisted `senderDb.sessionId.<cmd> = randomUUID()`. Cat-Bot
// exposes the same per-user store through db.users.collection(senderID); we keep
// one dedicated collection so chat sessions are namespaced and easy to clear.

const SESSION_COLLECTION = 'ai_session';

/** Resolves (creating if needed) the per-user session token for a chat command. */
async function getOrCreateSession(
  ctx: AppCtx,
  senderID: string,
  key: string,
): Promise<string> {
  const userColl = ctx.db.users.collection(senderID);
  if (!(await userColl.isCollectionExist(SESSION_COLLECTION))) {
    await userColl.createCollection(SESSION_COLLECTION);
  }
  const sess = await userColl.getCollection(SESSION_COLLECTION);
  let sessionId = (await sess.get(key)) as string | undefined;
  if (!sessionId) {
    sessionId = randomUUID();
    await sess.set(key, sessionId);
  }
  return sessionId;
}

/** Clears the per-user session token, effectively resetting a conversation. */
async function clearSession(
  ctx: AppCtx,
  senderID: string,
  key: string,
): Promise<void> {
  const userColl = ctx.db.users.collection(senderID);
  if (!(await userColl.isCollectionExist(SESSION_COLLECTION))) return;
  const sess = await userColl.getCollection(SESSION_COLLECTION);
  await sess.delete(key);
}

// ── Image attachment resolution (for vision-capable models) ────────────────
//
// Same convention as hd.ts / popcat-media.ts: read a public URL off the unified
// attachment list of the triggering message, falling back to the replied message.

interface RawAttachment {
  type?: string;
  url?: string | null;
  filename?: string | null;
  name?: string | null;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp)(?:\?.*)?$/i;

function isImageAttachment(att: RawAttachment): boolean {
  const type = (att.type ?? '').toLowerCase();
  if (
    type === AttachmentType.PHOTO ||
    type === AttachmentType.ANIMATED_IMAGE ||
    type === 'gif'
  ) {
    return true;
  }
  return IMAGE_EXT_RE.test(att.filename ?? att.name ?? att.url ?? '');
}

/** Resolves an image URL from the trigger or reply message, or null. */
async function resolveImageUrl(ctx: AppCtx): Promise<string | null> {
  const event = ctx.event;
  const direct = (event['attachments'] as RawAttachment[] | undefined) ?? [];
  const fromDirect = direct.find((a) => a?.url && isImageAttachment(a));
  if (fromDirect?.url) return fromDirect.url;

  const reply = event['messageReply'] as
    | Record<string, unknown>
    | null
    | undefined;
  const replyAtts = (reply?.['attachments'] as RawAttachment[] | undefined) ?? [];
  const fromReply = replyAtts.find((a) => a?.url && isImageAttachment(a));
  if (fromReply?.url) return fromReply.url;

  return null;
}

// ── Config ────────────────────────────────────────────────────────────────────

interface AiChatConfig {
  name: string;
  aliases: string[];
  example: string;
  description: string;
  session?: boolean; // conversation memory + "reset" support
  supportsImage?: boolean; // forward an attached image to the model
  role?: RoleLevel;
  provider: string;
  endpoint: string;
  textParam: string; // 'teks' | 'text'
  model?: string; // optional model override (e.g. claude's "anthropic/…")
  resultPath: (data: unknown) => string | undefined;
}

const AI_CHAT_CONFIGS: AiChatConfig[] = [
  {
    name: 'chatgpt',
    aliases: ['gpt'] as string[], // original "ai" alias dropped (conflicts with /ai agent)
    example: 'What is Evangelion?',
    description: 'Chat with ChatGPT (GPT-4o mini). It can also see attached images.',
    session: true,
    supportsImage: true,
    provider: 'alwayscodex',
    endpoint: '/api/ai/gpt4o-mini',
    textParam: 'teks',
    resultPath: (d) => (d as { result?: string })?.result,
  },
  {
    name: 'claude',
    aliases: [] as string[],
    example: 'What is Evangelion?',
    description: 'Chat with Claude (Haiku 4.5) with conversation memory.',
    session: true,
    provider: 'alwayscodex',
    endpoint: '/api/ai/chatgpt-org',
    textParam: 'teks',
    model: 'anthropic/claude-haiku-4-5',
    resultPath: (d) => (d as { result?: string })?.result,
  },
  {
    name: 'copilot',
    aliases: [] as string[],
    example: 'What is Evangelion?',
    description: 'Chat with Microsoft Copilot.',
    provider: 'nexray',
    endpoint: '/ai/copilot',
    textParam: 'text',
    resultPath: (d) => (d as { result?: string })?.result,
  },
  {
    name: 'deepseek',
    aliases: [] as string[],
    example: 'What is Evangelion?',
    description: 'Chat with DeepSeek (Flash) with conversation memory.',
    session: true,
    provider: 'alwayscodex',
    endpoint: '/api/ai/deepseek-flash',
    textParam: 'teks',
    resultPath: (d) => (d as { result?: string })?.result,
  },
  {
    name: 'gemini',
    aliases: [] as string[],
    example: 'What is Evangelion?',
    description: 'Chat with Google Gemini Pro.',
    provider: 'alwayscodex',
    endpoint: '/api/ai/gemini-pro',
    textParam: 'teks',
    resultPath: (d) => (d as { result?: string })?.result,
  },
  {
    name: 'perplexity',
    aliases: [] as string[],
    example: 'What is Evangelion?',
    description: 'Chat with Perplexity (Sonar) with conversation memory.',
    session: true,
    provider: 'alwayscodex',
    endpoint: '/api/ai/chatgpt-org',
    textParam: 'teks',
    model: 'perplexity/sonar',
    resultPath: (d) => (d as { result?: string })?.result,
  },
  {
    name: 'qwen',
    aliases: [] as string[],
    example: 'What is Evangelion?',
    description: 'Chat with Qwen 2.5 (72B) with conversation memory.',
    session: true,
    provider: 'alwayscodex',
    endpoint: '/api/ai/chatgpt-org',
    textParam: 'teks',
    model: 'qwen/qwen-2.5-72b-instruct',
    resultPath: (d) => (d as { result?: string })?.result,
  },
  {
    name: 'venice',
    aliases: [] as string[],
    example: 'What is Evangelion?',
    description: 'Chat with Venice AI.',
    provider: 'alwayscodex',
    endpoint: '/api/ai/venice',
    textParam: 'teks',
    resultPath: (d) => (d as { result?: string })?.result,
  },
];

// ── Shared handler ─────────────────────────────────────────────────────────────

async function runAiChat(ctx: AppCtx, cfg: AiChatConfig): Promise<void> {
  const { chat, event, args, usage } = ctx;

  const senderID = event['senderID'] ?? event['userID'];
  if (typeof senderID !== 'string' || !senderID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Could not identify your user ID on this platform.',
    });
    return;
  }

  const messageReply = event['messageReply'] as
    | Record<string, unknown>
    | undefined;
  const quotedBody = (messageReply?.['message'] as string | undefined) ?? '';

  const input = args.join(' ').trim() || quotedBody.trim();
  if (!input) {
    await usage();
    return;
  }

  // ── Reset request for session-backed commands ─────────────────────────────
  if (cfg.session && input.toLowerCase() === 'reset') {
    await clearSession(ctx, senderID, cfg.name);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '🧹 **Conversation history has been reset.**',
    });
    return;
  }

  try {
    const params: Record<string, string> = { [cfg.textParam]: input };
    if (cfg.model) params['model'] = cfg.model;
    if (cfg.session) {
      params['session'] = await getOrCreateSession(ctx, senderID, cfg.name);
    }
    if (cfg.supportsImage) {
      const imageUrl = await resolveImageUrl(ctx);
      if (imageUrl) params['image'] = imageUrl;
    }

    const apiUrl = createUrl(cfg.provider, cfg.endpoint, params);
    const { data } = await axios.get(apiUrl);
    const result = cfg.resultPath(data);
    if (typeof result !== 'string' || !result.trim()) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '⚠️ The AI returned an empty response. Try again in a moment.',
      });
      return;
    }
    await chat.replyMessage({ style: MessageStyle.TEXT, message: result });
  } catch (err) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ An error occurred while contacting the AI. The service might be temporarily unavailable.',
    });
    ctx.logger.error(`[${cfg.name}] request failed`, { error: err });
  }
}

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = AI_CHAT_CONFIGS.map((cfg) => ({
  meta: {
    name: cfg.name,
    aliases: cfg.aliases,
    version: '1.0.0',
    role: cfg.role ?? Role.ANYONE,
    author: 'AjiroDesu',
    description: cfg.description,
    category: 'AI Chat',
    usage: cfg.session ? ['<text>', 'reset'] : '<text>',
    cooldown: 5,
    hasPrefix: true,
    payment: 10,
    options: [
      {
        type: OptionType.string,
        name: 'text',
        description: `Your prompt (e.g. "${cfg.example}")`,
        required: false,
      },
    ],
  },
  onCommand: async (ctx: AppCtx) => runAiChat(ctx, cfg),
}));