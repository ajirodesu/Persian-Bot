/**
 * AI Agent — Handler
 *
 * Port of canis's src/components/ai/personalityHandler.ts + agentHandler.ts,
 * adapted to Cat-Bot's AppCtx. Responsibilities:
 *
 *   • runAgent(ctx)            — full agent turn (tools, files, bot commands)
 *   • maybeRunAgentOnChat(ctx) — natural-language activation on every message
 *                                (active session / trigger word / @mention)
 *   • generateSimpleText(...)  — cached, no-tools completion (canis agentHandler,
 *                                used by the roast command)
 *
 * The ToolContext is bound to the live cat-bot context: platform user/thread
 * lookups go through ctx.user/ctx.thread, files are delivered via chat.reply,
 * and bot commands run through the real command dispatcher.
 */

import axios from 'axios';
import type { BaseCtx } from '@/engine/types/controller.types.js';
import type { OnCommandCtx } from '@/engine/types/middleware.types.js';
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import { dispatchCommand } from '@/engine/controllers/dispatchers/command.dispatcher.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import { withTypingIndicator } from '@/engine/lib/typing-indicator.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { getBotNickname } from '@/engine/repos/session.repo.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';
import {
  cachedIsBotAdmin,
  cachedIsThreadAdmin,
  cachedIsSystemAdmin,
} from '@/engine/lib/auth-cache.lib.js';
import {
  getCachedSessionAdminOnly,
  setCachedSessionAdminOnly,
  getCachedThreadAdminBox,
  setCachedThreadAdminBox,
} from '@/engine/lib/admin-only-state.lib.js';
import { getMaintenanceModeEnabled } from '@/engine/repos/maintenance-mode.repo.js';
import { cooldownStore } from '@/engine/lib/cooldown.lib.js';
import { AttachmentType } from '@/engine/adapters/models/enums/attachment-type.enum.js';
import { createMcpToolSet } from './mcp-tools.lib.js';
import type { ToolContext } from '../agent-tool.types.js';
import {
  runAgentTurn,
  type ImageData,
  type ToolLogEntry,
} from './agent-runner.lib.js';
import {
  buildAgentSystemPrompt,
  buildCommandCatalog,
  buildThreadEntry,
} from './agent-prompt.lib.js';
import { deliverCombinedResult } from '../tools/send_results.js';
import { containsMarkdown } from './markdown.util.js';
import { resolveAgentConfig } from './agent-config.lib.js';
import { AI_PROVIDERS } from '@/engine/repos/ai-provider.constants.js';
import {
  type AgentThreadKey,
  getThread,
  appendThread,
  clearThread,
  isSessionActive,
  activateSession,
  deactivateSession,
  getCachedResult,
  cacheResult,
  acquireTurnLock,
  releaseTurnLock,
} from './agent-thread.lib.js';
import {
  detectActivation,
  stripAgentTrigger,
} from './agent-personalities.lib.js';

// ── Copy / status messages (ported from canis) ────────────────────────────────
//
// NOTE: no per-tool status posts ("executing... give me a sec 💻" etc.). Those
// loader messages were separate chat messages on every platform, which read as
// the bot "editing" its loader when the real reply followed. Processing feedback
// is carried by the typing indicator alone (withTypingIndicator) so the final
// answer arrives as the one new message.

const GREETINGS = [
  'Hey! 👋 What can I help you with?',
  "Hey, I'm here! What's up? 😄",
  'Hello! Ready when you are ✨',
  'Yo! What do you need? 🤙',
];

const ERROR_REPLIES = [
  'something went wrong on my end, try again?',
  'ugh, ran into an issue. try again 😅',
  'that one broke on me, sorry. try again',
  'hit a snag, try again in a bit',
];

const NO_KEY_REPLY =
  '⚠️ No AI provider configured yet. Add your API key in the dashboard (AI Integration) ' +
  'to enable AI features — there is no server-side key anymore.';

// The system-prompt template (agent/system_prompt.md) is loaded and rendered in
// agent-prompt.lib.ts — a single source of truth for every text the LLM sees.
// The prompt deliberately does NOT inline the command list; the model discovers
// commands via list_commands/help (cheaper on tokens, and reused from history).

/** Minimal shape of a unified attachment entry. */
interface RawAttachment {
  type?: string;
  url?: string | null;
  filename?: string | null;
  name?: string | null;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp)(?:\?.*)?$/i;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

// ── Key / helpers ─────────────────────────────────────────────────────────────

function buildAgentKey(ctx: BaseCtx): AgentThreadKey {
  return {
    userId: ctx.native.userId ?? '',
    platform: ctx.native.platform ?? '',
    sessionId: ctx.native.sessionId ?? '',
    threadID: (ctx.event['threadID'] as string) ?? '',
    senderID: (ctx.event['senderID'] as string) ?? '',
  };
}

/**
 * Resolves the session's configured bot nickname (set via the dashboard) so the
 * agent can activate on it like the configured trigger word. LRU-cached in the
 * repo layer; fail-open to null so a DB hiccup never blocks agent activation.
 */
async function resolveBotNickname(ctx: BaseCtx): Promise<string | null> {
  const userId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  if (!userId || !sessionId) return null;
  try {
    return await getBotNickname(userId, ctx.native.platform, sessionId);
  } catch {
    return null;
  }
}

/**
 * Formats the current time in the user's timezone, e.g.
 * "Tuesday, August 16, 2026 at 3:45 PM (Asia/Manila, GMT+8)" — so the agent
 * reasons about dates/times in the user's local zone, not the server's.
 */
function formatLocalNow(timeZone: string): string {
  const now = new Date();
  try {
    const datePart = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(now);
    const timePart = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(now);
    // e.g. "GMT+8" or "PDT" — human-readable offset for the LLM.
    let zone = '';
    try {
      zone =
        new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
          .formatToParts(now)
          .find((p) => p.type === 'timeZoneName')?.value ?? '';
    } catch {
      zone = '';
    }
    return `${datePart} at ${timePart} (${timeZone}${zone ? `, ${zone}` : ''})`;
  } catch {
    // Garbage zone (shouldn't happen — the repo validates) — degrade to UTC.
    return now.toUTCString();
  }
}

/** Title-cases a trigger name for display ("cat-bot" → "Cat-Bot", "miko" → "Miko"). */
function displayName(name: string): string {
  return name.toLowerCase() === 'cat-bot'
    ? 'Cat-Bot'
    : name.charAt(0).toUpperCase() + name.slice(1);
}

// Short-lived per-sender caches for prompt personalization (name/role rarely
// change mid-conversation; DB reads would otherwise run on every turn).
const IDENTITY_CACHE_TTL_MS = 30_000;

/**
 * Resolves the sender's display name for the system prompt, failing open to
 * "User" so a name lookup hiccup never blocks a turn. Cached 30s per sender.
 */
async function resolveSenderName(
  ctx: BaseCtx,
  senderID: string,
): Promise<string> {
  if (!senderID) return 'User';
  const cacheKey = `agent:uname:${senderID}`;
  const cached = lruCache.get<string>(cacheKey);
  if (cached) return cached;
  try {
    const name = (await ctx.user.getName(senderID))?.trim() || 'User';
    lruCache.set(cacheKey, name, IDENTITY_CACHE_TTL_MS);
    return name;
  } catch {
    return 'User';
  }
}

/**
 * Resolves the sender's role label for the system prompt — the same checks
 * the upstream Cat-Bot uses: Bot Administrator > Thread Administrator >
 * Regular User. Fail-open to Regular User on DB errors. The auth checks are
 * memoized per request (auth-cache) and LRU-cached at the repo layer.
 */
async function resolveUserRoleLabel(
  ctx: BaseCtx,
  key: AgentThreadKey,
): Promise<string> {
  const { senderID, userId, sessionId, platform, threadID } = key;
  if (!senderID) return 'Regular User';
  const cacheKey = `agent:urole:${senderID}`;
  const cached = lruCache.get<string>(cacheKey);
  if (cached) return cached;
  try {
    let role = 'Regular User';
    if (userId && sessionId) {
      const isAdmin = await cachedIsBotAdmin(
        ctx,
        userId,
        platform,
        sessionId,
        senderID,
      );
      if (isAdmin) role = 'Bot Administrator';
    }
    if (role === 'Regular User' && threadID) {
      const isThreadAdm = await cachedIsThreadAdmin(ctx, threadID, senderID);
      if (isThreadAdm) role = 'Thread Administrator';
    }
    lruCache.set(cacheKey, role, IDENTITY_CACHE_TTL_MS);
    return role;
  } catch {
    // Fail-open — a temporary DB outage defaults to Regular User.
    return 'Regular User';
  }
}

/** Captured media keys from every test_command run in a turn's tool log. */
interface CapturedMediaKeys {
  attachmentUrlKeys: string[];
  binaryKeys: string[];
  buttonKeys: string[];
  /** True when any captured media key is non-empty (media must be delivered). */
  hasMedia: boolean;
}

/**
 * Scans the turn's tool log for test_command results and collects every
 * non-null attachment / binary / button key. The runner keeps test_command
 * results in full (see execFn in agent-runner.lib.ts) precisely so this
 * fallback can find the keys the model may have failed to pass to send_result.
 */
function collectCapturedMediaKeys(toolLog: ToolLogEntry[]): CapturedMediaKeys {
  const keys: CapturedMediaKeys = {
    attachmentUrlKeys: [],
    binaryKeys: [],
    buttonKeys: [],
    hasMedia: false,
  };
  for (const entry of toolLog) {
    if (entry.name !== 'test_command') continue;
    try {
      const parsed = JSON.parse(entry.result) as Record<string, unknown>;
      const aKey = parsed['attachment_key'];
      const bKey = parsed['binary_attachment_key'];
      const btnKey = parsed['button_key'];
      if (typeof aKey === 'string' && aKey) keys.attachmentUrlKeys.push(aKey);
      if (typeof bKey === 'string' && bKey) keys.binaryKeys.push(bKey);
      if (typeof btnKey === 'string' && btnKey) keys.buttonKeys.push(btnKey);
    } catch {
      // Not JSON (e.g. an error string) — nothing to collect.
    }
  }
  keys.hasMedia =
    keys.attachmentUrlKeys.length > 0 ||
    keys.binaryKeys.length > 0 ||
    keys.buttonKeys.length > 0;
  return keys;
}

/**
 * True when the model's reply text looks like the raw test_command JSON output
 * (a "calls"/"attachment_key" dump) rather than a synthesized caption. Such
 * dumps must never be shown to the user — media should be delivered instead.
 */
function looksLikeRawToolDump(text: string | null): boolean {
  if (!text) return false;
  const t = text.trim();
  if (!t.startsWith('{')) return false;
  return (
    t.includes('"callCount"') ||
    t.includes('"attachment_key"') ||
    t.includes('"calls"')
  );
}

/**
 * Pulls a human-readable caption from the captured test_command calls — the
 * first replyMessage `message` the tested command itself would have sent. Used
 * as the fallback caption when the model only returned a raw JSON dump.
 */
function extractCapturedCaption(toolLog: ToolLogEntry[]): string | null {
  for (const entry of toolLog) {
    if (entry.name !== 'test_command') continue;
    try {
      const parsed = JSON.parse(entry.result) as {
        calls?: Array<{ message?: unknown }>;
      };
      const calls = parsed.calls ?? [];
      for (const call of calls) {
        if (typeof call?.message === 'string' && call.message.trim()) {
          return call.message.trim();
        }
      }
    } catch {
      // Not JSON — skip.
    }
  }
  return null;
}

function looksLikeImage(att: RawAttachment): boolean {
  const type = (att.type ?? '').toLowerCase();
  if (
    type === AttachmentType.PHOTO ||
    type === AttachmentType.ANIMATED_IMAGE ||
    type === 'gif'
  ) {
    return true;
  }
  return (
    IMAGE_EXT_RE.test(att.url ?? '') || IMAGE_EXT_RE.test(att.filename ?? '')
  );
}

/** Best-effort: download the first image attachment as base64 for vision input. */
async function resolveImageData(ctx: BaseCtx): Promise<ImageData | undefined> {
  const direct =
    (ctx.event['attachments'] as RawAttachment[] | undefined) ?? [];
  const reply = ctx.event['messageReply'] as
    Record<string, unknown> | undefined;
  const replyAttachments =
    (reply?.['attachments'] as RawAttachment[] | undefined) ?? [];
  const candidate = [...direct, ...replyAttachments].find(
    (a) => a?.url && looksLikeImage(a),
  );
  if (!candidate?.url) return undefined;

  try {
    const res = await axios.get<ArrayBuffer>(candidate.url, {
      responseType: 'arraybuffer',
      timeout: 20_000,
      maxContentLength: 10 * 1024 * 1024,
      maxBodyLength: 10 * 1024 * 1024,
    });
    const buf = Buffer.from(res.data);
    if (buf.length === 0) return undefined;
    const mimetype =
      (res.headers['content-type'] as string | undefined) ?? 'image/png';
    if (!mimetype.startsWith('image/')) return undefined;
    return { data: buf.toString('base64'), mimetype };
  } catch (err) {
    logger.debug('[Agent] image download failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

// ── ToolContext binding ────────────────────────────────────────────────────────

/** Wraps the API so command replies are captured for thread accuracy. */
function withReplyCapture(
  api: UnifiedApi,
  capture: (text: string) => void,
): UnifiedApi {
  const wrapped = Object.create(api) as UnifiedApi;
  wrapped.replyMessage = async (threadID, options = {}) => {
    const m = options.message;
    if (typeof m === 'string') capture(m);
    else if (
      m &&
      typeof m === 'object' &&
      typeof (m as { message?: unknown }).message === 'string'
    ) {
      capture((m as { message: string }).message);
    }
    return api.replyMessage(threadID, options);
  };
  return wrapped;
}

function buildToolContext(ctx: BaseCtx): ToolContext {
  const threadID = (ctx.event['threadID'] as string) ?? '';

  // Spread the live bot context into the tool context — ToolContext extends
  // BaseCtx so command-aware tools (help, test_command, send_result) can reach
  // api, event, commands, prefix and native directly, while the helper surface
  // below stays available to the browser/command tools.
  return {
    ...ctx,

    getUserInfo: async (userID: string) => {
      try {
        return await ctx.user.getInfo(userID.trim());
      } catch {
        return null;
      }
    },

    getThreadInfo: async (tid: string) => {
      try {
        return await ctx.thread.getInfo(tid.trim());
      } catch {
        return null;
      }
    },

    listCommands: async (role = 'all') =>
      buildCommandCatalog(ctx.commands, ctx.native.platform ?? '', role),

    runBotCommand: async (command: string) => {
      const [name, ...rest] = command.trim().split(/\s+/);
      const key = (name ?? '').toLowerCase();
      const mod = key ? ctx.commands.get(key) : undefined;
      if (!mod || typeof mod['onCommand'] !== 'function') {
        return { ok: false, error: `Command "${key}" not found` };
      }
      if (!isPlatformAllowed(mod, ctx.native.platform)) {
        return {
          ok: false,
          error: `Command "${key}" is not supported on this platform`,
        };
      }

      const captured: string[] = [];
      const captureApi = withReplyCapture(ctx.api, (t) => captured.push(t));
      const onCommandCtx: OnCommandCtx = {
        ...ctx,
        api: captureApi,
        parsed: { name: key, args: rest },
        prefix: ctx.prefix ?? '',
        mod,
        options: OptionsMap.empty(),
      };

      try {
        await dispatchCommand(
          { name: key, args: rest },
          onCommandCtx,
          captureApi,
          threadID,
          ctx.prefix ?? '',
        );
        return {
          ok: true,
          output: captured[captured.length - 1] ?? 'Done.',
        };
      } catch (err: unknown) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    // No onToolCall status posts — see the header note. Processing feedback is
    // the typing indicator (withTypingIndicator around the whole turn), so the
    // final reply is the single new message and no loader message ever exists.
  };
}

// ── Agent turn (personalityHandler.runAgent) ──────────────────────────────────

/**
 * Main entry point for the agent. Handles text replies, bot command execution,
 * and vision input. Commands pass an explicit query override (the event body
 * still carries the command prefix + name); plain-chat activation reads the
 * raw body, stripping a leading "<agent-name> " prefix.
 */
export async function runAgent(
  ctx: BaseCtx,
  queryOverride?: string,
): Promise<void> {
  const key = buildAgentKey(ctx);
  // Serialize turns per (session, thread, sender): if a turn is already running
  // for this key, a burst of follow-up messages must not start a second one and
  // race on the thread store. The skipped message's content is naturally picked
  // up by the active session on the sender's next message.
  if (key.senderID && key.threadID && !acquireTurnLock(key)) return;
  try {
    try {
      await runAgentUnsafe(ctx, queryOverride);
    } catch (err) {
      // The command dispatcher and the natural-language path BOTH swallow thrown
      // errors silently (command.dispatcher.ts logs and returns) — if anything
      // unexpected fails mid-turn the user would see NOTHING. Reply with a
      // fallback so the agent can never go silent on an internal error.
      logger.error('[Agent] runAgent failed', { error: err });
      try {
        await ctx.chat.replyMessage({ message: pick(ERROR_REPLIES) });
      } catch {
        // Even the fallback failed — nothing more we can do.
      }
    }
  } finally {
    if (key.senderID && key.threadID) releaseTurnLock(key);
  }
}

async function runAgentUnsafe(
  ctx: BaseCtx,
  queryOverride?: string,
): Promise<void> {
  const key = buildAgentKey(ctx);
  const { threadID, senderID } = key;
  if (!senderID || !threadID) return;

  // Resolve everything the turn needs up front, in parallel: the per-user
  // config (LRU-cached 30s) plus the identity context for the system prompt
  // (nickname, sender name, sender role — all cached too). Nothing here
  // depends on anything else, so a single Promise.all avoids four sequential
  // round-trips before the first LLM call.
  const [config, botNickname, userName, userRole] = await Promise.all([
    resolveAgentConfig(key.userId || undefined),
    resolveBotNickname(ctx),
    resolveSenderName(ctx, senderID),
    resolveUserRoleLabel(ctx, key),
  ]);

  let query = (queryOverride ?? '').trim();
  if (!query) {
    const rawBody = (ctx.event['message'] ?? ctx.event['body'] ?? '') as string;
    // Strip a leading trigger name (the web-configured agent name or the bot's
    // nickname) so the query sent to the LLM doesn't repeat the bot's own name.
    query = stripAgentTrigger(
      rawBody,
      botNickname ? [botNickname] : [],
      config.agentName,
    ).trim();
  }

  // Append quoted message if present.
  const replyEvent = ctx.event['messageReply'] as
    { message?: string } | undefined;
  if (replyEvent?.message) {
    query = query
      ? `${query}\n[Quoted: ${replyEvent.message}]`
      : `[Quoted: ${replyEvent.message}]`;
  }

  // Image attachment → passed to the LLM as vision input.
  const imageData = await resolveImageData(ctx);

  // Nothing to work with — greet and open a session.
  if (!query && !imageData) {
    await ctx.chat.replyMessage({ message: pick(GREETINGS) });
    activateSession(key);
    return;
  }

  const mentioned = hasMentions(ctx);
  const history = getThread(key);
  if (!config.apiKey) {
    await ctx.chat.replyMessage({ message: NO_KEY_REPLY });
    return;
  }

  // Cat-Bot style personalization: fill the compact agentic system prompt with
  // the bot's name (session nickname or trigger word), the sender's name +
  // role, and the command prefix. The command catalogue is NOT inlined here —
  // the model discovers it once via list_commands and reuses it from history,
  // which keeps every turn (including each tool iteration) much cheaper.
  const systemPrompt = buildAgentSystemPrompt({
    mentioned,
    botName: botNickname ?? displayName(config.agentName),
    userName,
    userRole,
    prefix: ctx.prefix ?? '/',
    currentDatetime: formatLocalNow(config.timezone),
    modelName: config.model,
    providerName: AI_PROVIDERS[config.provider]?.label ?? config.provider,
  });

  const toolContext = buildToolContext(ctx);
  // Spin up the in-process MCP server bound to this turn's context — the
  // runner lists schemas and executes tool calls through the MCP protocol.
  const tools = await createMcpToolSet(toolContext);
  const threadQuery = imageData
    ? query
      ? `[Image] ${query}`
      : '[Image]'
    : query;

  logger.info('[Agent]', `${senderID} → ${query.slice(0, 80)}`);

  const result = await runAgentTurn({
    systemPrompt,
    history,
    userQuery: query || '[Describe this image]',
    tools,
    context: toolContext,
    provider: config.provider,
    apiKey: config.apiKey,
    model: config.model,
    imageData,
    maxToolIterations: config.maxToolIterations,
  });

  activateSession(key);
  const threadLimits = {
    maxHistory: config.maxHistory,
    ttlSeconds: config.threadTtl,
  };

  // The send_result tool already delivered the reply (synthesized text +
  // attachments/buttons) via its own platform call — never double-post the
  // turn's final text on top of it. Only count calls that actually delivered:
  // a failed delivery (or a repeat call that was skipped by the idempotency
  // guard) must not suppress the fallback reply below.
  const lastSendResult = [...result.toolLog]
    .reverse()
    .find((t) => t.name === 'send_result');
  const deliveredViaSendResult =
    !!lastSendResult && !lastSendResult.result.startsWith('Delivery failed');
  if (deliveredViaSendResult) {
    appendThread(key, threadQuery, buildThreadEntry(result.toolLog, result.text), threadLimits);
    return;
  }

  // Priority 1: bot command — run it via the real dispatcher, capture output.
  if (result.commandToExecute) {
    const { ok, output, error } = await toolContext.runBotCommand(
      result.commandToExecute,
    );
    const threadAssistant = ok
      ? `[Executed command: ${result.commandToExecute} → ${output ?? 'Done.'}]`
      : `[Command failed: ${result.commandToExecute} → ${error ?? 'unknown error'}]`;
    if (ok) {
      appendThread(key, threadQuery, threadAssistant, threadLimits);
    } else {
      await ctx.chat.replyMessage({
        message: `hmm, couldn't run "${result.commandToExecute}" 🤔 try asking differently`,
      });
      appendThread(key, threadQuery, threadAssistant, threadLimits);
    }
    return;
  }

  // Priority 2: media fallback — the model ran test_command (capturing
  // attachments/buttons) but never delivered via send_result or run_command,
  // often because it returned the raw tool JSON as its reply text. Auto-deliver
  // the captured media so a media command always sends the actual attachment
  // instead of a JSON dump. Keys are single-use and consumed here.
  const capturedMedia = collectCapturedMediaKeys(result.toolLog);
  if (capturedMedia.hasMedia) {
    const caption = looksLikeRawToolDump(result.text)
      ? extractCapturedCaption(result.toolLog)
      : result.text;
    const status = await deliverCombinedResult(toolContext, {
      message: caption ?? 'Here you go! 🎉',
      attachment_url: capturedMedia.attachmentUrlKeys,
      button: capturedMedia.buttonKeys,
      attachment: capturedMedia.binaryKeys,
    });
    const threadAssistant = buildThreadEntry(
      result.toolLog,
      caption && !looksLikeRawToolDump(caption) ? caption : null,
    );
    appendThread(key, threadQuery, threadAssistant, threadLimits);
    // Only short-circuit when delivery actually succeeded — a failed delivery
    // falls through to the plain-text path so the user still gets a reply.
    if (!status.startsWith('Delivery failed')) return;
  }

  if (!result.text) {
    await ctx.chat.replyMessage({ message: pick(ERROR_REPLIES) });
    return;
  }

  // Never surface a raw test_command JSON dump as the reply (e.g. when the model
  // tested a text-only command but failed to deliver). Replace it with the
  // command's own caption or a neutral fallback.
  const replyText = looksLikeRawToolDump(result.text)
    ? (extractCapturedCaption(result.toolLog) ?? 'Here you go! 🎉')
    : result.text;

  // Concise assistant thread entry: one-line tool summary + the delivered
  // reply, so history stays small and the next turn keeps full context.
  const threadAssistant = buildThreadEntry(result.toolLog, replyText);

  // Auto-markdown: the model is prompted to format with bold/lists/code blocks,
  // but only text that actually contains supported Markdown syntax is delivered
  // as MARKDOWN. Plain conversational replies go out as TEXT so Telegram's
  // MarkdownV2 parser never rejects stray special characters. If a styled send
  // is rejected anyway (strict parsers, unbalanced model syntax), retry once as
  // plain text so the content still reaches the user instead of going silent.
  const finalStyle = containsMarkdown(replyText)
    ? MessageStyle.MARKDOWN
    : MessageStyle.TEXT;
  try {
    await ctx.chat.replyMessage({ style: finalStyle, message: replyText });
  } catch (sendErr) {
    logger.debug('[Agent] styled reply rejected — retrying as plain text', {
      error: sendErr,
    });
    await ctx.chat.replyMessage({
      style: MessageStyle.TEXT,
      message: replyText,
    });
  }
  appendThread(key, threadQuery, threadAssistant, threadLimits);
}

/** True when the message mentions anyone (any platform mention entity). */
function hasMentions(ctx: BaseCtx): boolean {
  const mentions = ctx.event['mentions'] as Record<string, unknown> | undefined;
  return !!mentions && Object.keys(mentions).length > 0;
}

/** Runs the agent turn with a live typing indicator (onChat activation path). */
async function runAgentWithIndicator(ctx: BaseCtx): Promise<void> {
  const threadID = (ctx.event['threadID'] as string) ?? '';
  await withTypingIndicator(ctx.api, threadID, () => runAgent(ctx));
}

// ── Access guard (maintenance / admin-only modes) ─────────────────────────────

/**
 * Enforces the same restriction modes the command middleware applies, for the
 * natural-language agent path (which never passes through the dispatcher):
 *
 *   1. Maintenance Mode   (global)      → System Admins only
 *   2. Bot Admin Only     (session-wide) → bot admins only
 *   3. Group Admin Only   (per-thread)   → group / bot / system admins only
 *
 * Mirrors enforceMaintenanceMode + enforceAdminOnly in on-command.middleware.ts
 * (same messages, same LRU fast-path caches, same 15s notification dedup) so
 * the AI respects these modes exactly like every command does. The per-command
 * ignore lists do NOT apply here — the natural-language agent is not a command,
 * so when a mode is on, non-privileged users get no AI. Fail-open on DB errors.
 *
 * Returns true when the turn may proceed, false when it was blocked (a notice
 * was already sent, throttled to one per 15s per user/thread).
 */
export async function enforceAgentAccess(ctx: BaseCtx): Promise<boolean> {
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;
  const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string;
  const threadID = (ctx.event['threadID'] ?? '') as string;
  const now = Date.now();

  // ── 1. Maintenance Mode — global, System Admins only ───────────────────────
  try {
    const maintenance = await getMaintenanceModeEnabled();
    if (maintenance) {
      const isSysAdmin = senderID
        ? await cachedIsSystemAdmin(ctx, senderID)
        : false;
      if (!isSysAdmin) {
        const key = `maintenance_noti:${senderID || 'unknown'}`;
        if (cooldownStore.check(key, now) === null) {
          await ctx.chat.replyMessage({
            message:
              '🚫 The bot is under maintenance — only System Admins may use commands right now.',
            attachment_url: [
              {
                name: 'maintenance-mode.png',
                url: 'https://i.postimg.cc/rF1Y5ky9/maintenance-mode.png',
              },
            ],
          });
          cooldownStore.record(key, now, 15000);
        }
        return false;
      }
    }
  } catch {
    /* fail-open */
  }

  // Fast-path: skip all async DB reads when both admin-only modes are
  // known-off (populated on the first check per session/thread) — the common
  // case, and this guard runs on every non-command message.
  if (sessionUserId && sessionId) {
    const sessOff =
      getCachedSessionAdminOnly(sessionUserId, platform, sessionId) === false;
    const threadOff =
      !threadID ||
      getCachedThreadAdminBox(
        sessionUserId,
        platform,
        sessionId,
        threadID,
      ) === false;
    if (sessOff && threadOff) return true;
  }

  // ── 2. Session-wide Bot Admin Only (db.bot → session_settings) ─────────────
  if (sessionUserId && sessionId) {
    try {
      const botColl = ctx.db.bot;
      if (await botColl.isCollectionExist('session_settings')) {
        const h = await botColl.getCollection('session_settings');
        const settings = await h.getAll();
        const enabled = settings['adminOnlyEnabled'] as boolean | null;
        if (enabled !== null && enabled !== undefined) {
          setCachedSessionAdminOnly(
            sessionUserId,
            platform,
            sessionId,
            enabled === true,
          );
        }
        if (enabled === true) {
          const isSysAdmin = senderID
            ? await cachedIsSystemAdmin(ctx, senderID)
            : false;
          const isAdmin =
            !isSysAdmin &&
            senderID &&
            sessionUserId &&
            sessionId
              ? await cachedIsBotAdmin(
                  ctx,
                  sessionUserId,
                  platform,
                  sessionId,
                  senderID,
                )
              : isSysAdmin;
          if (!isAdmin) {
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
            return false;
          }
        }
      } else {
        setCachedSessionAdminOnly(sessionUserId, platform, sessionId, false);
      }
    } catch {
      /* fail-open */
    }
  }

  // ── 3. Per-thread Group Admin Only (db.threads → adminbox_settings) ────────
  if (threadID) {
    try {
      const threadColl = ctx.db.threads.collection(threadID);
      if (await threadColl.isCollectionExist('adminbox_settings')) {
        const h = await threadColl.getCollection('adminbox_settings');
        const settings = await h.getAll();
        const enabled = settings['enabled'] as boolean | null;
        if (enabled !== null && enabled !== undefined && sessionUserId && sessionId) {
          setCachedThreadAdminBox(
            sessionUserId,
            platform,
            sessionId,
            threadID,
            enabled === true,
          );
        }
        if (enabled === true) {
          const isSysAdmin = senderID
            ? await cachedIsSystemAdmin(ctx, senderID)
            : false;
          let allowed = isSysAdmin;
          if (!allowed && senderID && sessionUserId && sessionId) {
            allowed = await cachedIsBotAdmin(
              ctx,
              sessionUserId,
              platform,
              sessionId,
              senderID,
            );
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
                  message: '🚫 Only group admins can use the bot in this thread.',
                });
                cooldownStore.record(key, now, 15000);
              }
            }
            return false;
          }
        }
      } else if (sessionUserId && sessionId) {
        setCachedThreadAdminBox(
          sessionUserId,
          platform,
          sessionId,
          threadID,
          false,
        );
      }
    } catch {
      /* fail-open */
    }
  }

  return true;
}

// ── Natural-language activation (canis message.ts) ────────────────────────────

/**
 * Runs on every non-command message (onChat). Continues an active session,
 * then triggers on the agent name word or a bot @mention — mirroring canis's
 * message.ts AI routing. The maintenance / admin-only guards run first, so a
 * restricted bot never answers natural-language messages.
 */
export async function maybeRunAgentOnChat(ctx: BaseCtx): Promise<void> {
  const body = (ctx.event['message'] ?? ctx.event['body'] ?? '') as string;
  if (!body) return;

  // Skip command invocations — commands are handled by the dispatcher and
  // must never be hijacked by natural-language activation.
  const prefix = ctx.prefix ?? '';
  if (prefix && body.trim().startsWith(prefix)) return;

  const key = buildAgentKey(ctx);
  if (!key.senderID || !key.threadID) return;

  // Maintenance / Bot Admin Only / Group Admin Only gates — when any is on,
  // non-privileged senders are blocked (with a throttled notice) before the
  // session continuation, trigger word, or @mention can fire.
  if (!(await enforceAgentAccess(ctx))) return;

  // 1. Active session → continue the conversation without a trigger word.
  if (isSessionActive(key)) {
    await runAgentWithIndicator(ctx);
    return;
  }

  // 2. Trigger word in the body (whole-word match) — the web-configured agent
  //    name ("cat" default), or the bot's configured nickname (e.g. "Miko" set
  //    via the dashboard).
  const botNickname = await resolveBotNickname(ctx);
  const config = await resolveAgentConfig(key.userId || undefined);
  if (
    detectActivation(
      body,
      botNickname ? [botNickname] : [],
      config.agentName,
    )
  ) {
    await runAgentWithIndicator(ctx);
    return;
  }

  // 3. @mention of the bot.
  const mentions = ctx.event['mentions'] as Record<string, string> | undefined;
  if (mentions && Object.keys(mentions).length > 0) {
    const keys = Object.keys(mentions);
    // Telegram: bot is mentioned by @username (mention entity) — compare to
    // the bot's own username from the grammY context.
    if (ctx.native.platform === Platforms.Telegram) {
      const botUsername = (
        ctx.native.ctx as { me?: { username?: string } } | undefined
      )?.me?.username;
      if (
        botUsername &&
        keys.some(
          (k) =>
            k.replace(/^@/, '').toLowerCase() === botUsername.toLowerCase(),
        )
      ) {
        await runAgentWithIndicator(ctx);
        return;
      }
    }
    try {
      const botID = await ctx.api.getBotID();
      if (botID && keys.includes(botID)) {
        await runAgentWithIndicator(ctx);
        return;
      }
    } catch {
      // Bot ID unavailable — fall through.
    }
  }
}

/** Clears a user's agent thread + session (forget command). */
export async function forgetAgent(ctx: BaseCtx): Promise<void> {
  const key = buildAgentKey(ctx);
  if (key.senderID && key.threadID) {
    clearThread(key);
    deactivateSession(key);
  }
  await ctx.chat.replyMessage({ message: 'done, fresh start 🧹' });
}

// ── Simple completion with caching (canis agentHandler) ───────────────────────

/**
 * One-shot, no-tools completion with prompt caching — the canis agentHandler
 * equivalent (used by roast.ts and other simple AI commands). Uses the user's
 * per-user provider config and returns null on failure.
 */
export async function generateSimpleText(
  ctx: BaseCtx,
  prompt: string,
): Promise<string | null> {
  const config = await resolveAgentConfig(ctx.native.userId);
  if (!config.apiKey) return null;

  // "Today" is rendered in the user's dashboard timezone, not server UTC.
  const today = formatLocalNow(config.timezone);

  const cached = getCachedResult(prompt, today);
  if (cached) return cached;

  try {
    const result = await runAgentTurn({
      systemPrompt: 'You are a helpful AI assistant. Today is %TODAY%.'.replace(
        '%TODAY%',
        today,
      ),
      history: [],
      userQuery: prompt,
      // No tools — an empty MCP tool set (schemas: [] means the LLM gets no
      // function declarations, and callTool is never reached).
      tools: {
        schemas: [],
        callTool: async () => '(no tools available)',
      },
      // No tools are passed to this completion, so the context is never used
      // for tool execution — only the helper surface matters here.
      context: {
        getUserInfo: async () => null,
        getThreadInfo: async () => null,
        listCommands: async () => '{}',
        runBotCommand: async () => ({ ok: false, error: 'Not available' }),
      } as unknown as ToolContext,
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
    });
    if (result.text) cacheResult(prompt, today, result.text);
    return result.text;
  } catch (err) {
    logger.error('[Agent] generateSimpleText failed', err);
    return null;
  }
}
