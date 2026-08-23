/**
 * AI Agent â€” Handler
 *
 * Port of canis's src/components/ai/personalityHandler.ts + agentHandler.ts,
 * adapted to Cat-Bot's AppCtx. Responsibilities:
 *
 *   â€¢ runAgent(ctx)            â€” full agent turn (tools, files, bot commands)
 *   â€¢ maybeRunAgentOnChat(ctx) â€” natural-language activation on every message
 *                                (active session / trigger word / @mention)
 *   â€¢ generateSimpleText(...)  â€” cached, no-tools completion (canis agentHandler,
 *                                used by the roast command)
 *
 * The ToolContext is bound to the live cat-bot context: platform user/thread
 * lookups go through ctx.user/ctx.thread, files are delivered via chat.reply,
 * and bot commands run through the real command dispatcher.
 */

import axios from 'axios';
import type { Readable } from 'node:stream';
import type { BaseCtx } from '@/engine/types/controller.types.js';
import type { OnCommandCtx } from '@/engine/types/middleware.types.js';
import type {
  EditMessageOptions,
  ButtonItem,
  NamedUrlAttachment,
} from '@/engine/adapters/models/interfaces/api.interfaces.js';
import { dispatchCommand } from '@/engine/controllers/dispatchers/command.dispatcher.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import {
  createChatContext,
  createBotContext,
} from '@/engine/adapters/models/context.model.js';
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
  AgentRateLimitError,
  type AgentTurnConfig,
  type AgentResult,
  type ImageData,
  type ToolLogEntry,
} from './agent-runner.lib.js';
import {
  buildAgentSystemPrompt,
  buildCommandCatalog,
  buildThreadEntry,
  buildTurnContextLine,
} from './agent-prompt.lib.js';
import { deliverCombinedResult } from '../tools/send_results.js';
import {
  resolveAgentConfig,
  resolveStoredApiKey,
} from './agent-config.lib.js';
import { AI_PROVIDERS, getFreeModelOf } from '@/engine/repos/ai-provider.constants.js';
import {
  type AgentProviderId,
  AGENT_PROVIDER_IDS,
} from './agent-providers.lib.js';
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
import {
  createAgentProgress,
  type AgentProgress,
} from './agent-progress.lib.js';
import type { CommandRunMedia } from '../agent-tool.types.js';

// â”€â”€ Copy / status messages (ported from canis) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Continuity model: a multi-step turn does NOT go silent while tools run.
// The first tool call posts ONE status message ("â³ Checking my available
// commandsâ€¦") and every subsequent step EDITS that same message in place â€”
// see agent-progress.lib.ts. When the turn finishes, the final answer is
// edited into that very message (plain-text answers), or the placeholder is
// unsent when the real reply went out through its own channel (send_result /
// command dispatch / media delivery). The typing indicator still runs for
// the platforms/timings it covers; the status message is the visible spine.

const GREETINGS = [
  'Hey! ðŸ‘‹ What can I help you with?',
  "Hey, I'm here! What's up? ðŸ˜„",
  'Hello! Ready when you are âœ¨',
  'Yo! What do you need? ðŸ¤™',
];

const ERROR_REPLIES = [
  'something went wrong on my end, try again?',
  'ugh, ran into an issue. try again ðŸ˜…',
  'that one broke on me, sorry. try again',
  'hit a snag, try again in a bit',
];

const NO_KEY_REPLY =
  'âš ï¸ No AI provider configured yet. Add your API key in the dashboard (AI Integration) ' +
  'to enable AI features â€” there is no server-side key anymore.';

// The system-prompt template (agent/system_prompt.md) is loaded and rendered in
// agent-prompt.lib.ts â€” a single source of truth for every text the LLM sees.
// The prompt deliberately does NOT inline the command list; the model discovers
// commands via list_commands/help (cheaper on tokens, and reused from history).

// â”€â”€ Automatic free/auto-model + rate-limit failover â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Providers with a free/auto tier (openrouter, groq, gemini, zen, orcarouter)
// run on their free/auto model by default (see preferFreeModel in agent-config)
// so turns don't instantly hit rate limits. If a turn is STILL rate-limited
// (429, after the runner's own backoff retries), the turn is retried on another
// provider that also has a saved key AND supports a free/auto model. OpenAI /
// NVIDIA / FastRouter have no free/auto tier, so they never participate â€” their
// keys only run when the user selects them explicitly.

/** A concrete provider/key/model combination a turn can run on. */
interface AgentRunPlan {
  provider: AgentProviderId;
  apiKey?: string | undefined;
  model: string;
}

/**
 * Builds the failover candidates for a rate-limited turn: every provider that
 * supports a free/auto model AND has a saved decryptable key, excluding the
 * provider that just got rate-limited. Empty when the user has no other
 * free-tier key â€” the rate-limit message is surfaced instead.
 */
async function buildFailoverPlans(
  userId: string | undefined,
  activeProvider: AgentProviderId,
): Promise<AgentRunPlan[]> {
  const plans: AgentRunPlan[] = [];
  for (const provider of AGENT_PROVIDER_IDS) {
    if (provider === activeProvider) continue;
    const freeModel = getFreeModelOf(provider);
    if (!freeModel) continue; // no free/auto tier â†’ never a candidate
    const apiKey = await resolveStoredApiKey(userId, provider);
    if (!apiKey) continue; // no saved key â†’ never a candidate
    plans.push({ provider, apiKey, model: freeModel });
  }
  return plans;
}

/**
 * Runs an agent turn on the primary provider, auto-failovering to other
 * free/auto providers on a rate limit. The system prompt is STATIC across
 * attempts (deliberately â€” a byte-identical system prompt + tool schema prefix
 * lets providers prompt-cache the input instead of re-billing it every turn);
 * the per-attempt model/provider identity rides in the turn context line
 * inside the user message instead. Never throws on rate limits â€” if every
 * candidate is rate-limited the turn resolves to the apology message.
 */
async function runAgentTurnWithFailover(
  userId: string | undefined,
  primary: AgentRunPlan,
  base: Omit<
    AgentTurnConfig,
    'systemPrompt' | 'provider' | 'apiKey' | 'model' | 'rethrowRateLimit'
  >,
  systemPrompt: string,
): Promise<AgentResult> {
  const attempt = async (plan: AgentRunPlan): Promise<AgentResult> =>
    runAgentTurn({
      ...base,
      // Attempt-specific identity (model/provider) rides at the END of the
      // user message so a failover never disturbs the cacheable prefix.
      userQuery: `${base.userQuery}\n[Running on: ${plan.model} via ${
        AI_PROVIDERS[plan.provider]?.label ?? plan.provider
      }]`,
      systemPrompt,
      provider: plan.provider,
      apiKey: plan.apiKey,
      model: plan.model,
      rethrowRateLimit: true,
    });

  try {
    return await attempt(primary);
  } catch (err) {
    if (!(err instanceof AgentRateLimitError)) throw err;
    logger.warn(
      `[Agent] ${primary.provider} rate-limited â€” failover to another free/auto provider`,
      { userId },
    );
    for (const plan of await buildFailoverPlans(userId, primary.provider)) {
      try {
        return await attempt(plan);
      } catch (e) {
        if (!(e instanceof AgentRateLimitError)) throw e;
        logger.warn(`[Agent] failover ${plan.provider} also rate-limited`, {
          userId,
        });
      }
    }
    return {
      text: "I'm being rate-limited right now. Please try again shortly.",
      commandToExecute: null,
      toolLog: [],
    };
  }
}

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

// â”€â”€ Key / helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
 * "Tuesday, August 16, 2026 at 3:45 PM (Asia/Manila, GMT+8)" â€” so the agent
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
    // e.g. "GMT+8" or "PDT" â€” human-readable offset for the LLM.
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
    // Garbage zone (shouldn't happen â€” the repo validates) â€” degrade to UTC.
    return now.toUTCString();
  }
}

/** Title-cases a trigger name for display ("cat-bot" â†’ "Cat-Bot", "miko" â†’ "Miko"). */
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
 * Resolves the sender's role label for the system prompt â€” the same checks
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
    // Fail-open â€” a temporary DB outage defaults to Regular User.
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
      // Not JSON (e.g. an error string) â€” nothing to collect.
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
 * dumps must never be shown to the user â€” media should be delivered instead.
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
 * Pulls a human-readable caption from the captured test_command calls â€” the
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
      // Not JSON â€” skip.
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

// â”€â”€ ToolContext binding â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Extracts Buffer/Readable attachment payloads from raw UnifiedApi call args
 * BEFORE any normalization can replace streams with sentinel strings — same
 * contract as test_command's capture (replyMessage/editMessage keep options at
 * args[1]; sendMessage carries the payload object at args[0]).
 */
function extractBinaryAttachments(
  method: string,
  args: unknown[],
): Array<{ name: string; stream: Readable | Buffer }> {
  let opts: Record<string, unknown> | null = null;
  if (method === 'replyMessage' || method === 'editMessage') {
    opts = (args[1] ?? {}) as Record<string, unknown>;
  } else if (method === 'sendMessage') {
    const p = args[0];
    if (p !== null && typeof p === 'object' && !Array.isArray(p)) {
      opts = p as Record<string, unknown>;
    }
  }
  if (!opts || !Array.isArray(opts['attachment'])) return [];
  const result: Array<{ name: string; stream: Readable | Buffer }> = [];
  for (const a of opts['attachment'] as unknown[]) {
    if (a !== null && typeof a === 'object') {
      const entry = a as Record<string, unknown>;
      const stream = entry['stream'];
      const isReadable =
        stream !== null &&
        typeof stream === 'object' &&
        typeof (stream as Record<string, unknown>)['pipe'] === 'function';
      if (Buffer.isBuffer(stream)) {
        result.push({ name: String(entry['name'] ?? 'attachment'), stream });
      } else if (isReadable) {
        result.push({
          name: String(entry['name'] ?? 'attachment'),
          stream: stream as Readable,
        });
      }
    }
  }
  return result;
}

function buildToolContext(
  ctx: BaseCtx,
  progress?: AgentProgress,
): ToolContext {
  const threadID = (ctx.event['threadID'] as string) ?? '';

  // Spread the live bot context into the tool context â€” ToolContext extends
  // BaseCtx so command-aware tools (help, test_command, send_result) can reach
  // api, event, commands, prefix and native directly, while the helper surface
  // below stays available to the browser/command tools.
  const toolContext: ToolContext = {
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

      // Continuity: agent-run commands execute SILENTLY. A Proxy intercepts
      // every delivery side-effect so nothing reaches the chat directly â€”
      // the handler then merges texts + media + buttons into ONE final
      // message (edited into the status bubble whenever one exists).
      const sideEffects = new Set([
        'replyMessage',
        'sendMessage',
        'editMessage',
        'reactToMessage',
        'unsendMessage',
        'setNickname',
        'setGroupName',
        'setGroupImage',
        'removeGroupImage',
        'addUserToGroup',
        'removeUserFromGroup',
        'setGroupReaction',
      ]);
      const deliveries: Array<{ method: string; args: unknown[] }> = [];
      // Binary payloads are held BEFORE any normalization can drop them.
      const binaries: Array<{ name: string; stream: Readable | Buffer }> = [];

      const silentApi = new Proxy(ctx.api, {
        get(target, prop) {
          if (typeof prop === 'string' && sideEffects.has(prop)) {
            return async (...mArgs: unknown[]) => {
              for (const b of extractBinaryAttachments(prop, mArgs)) {
                binaries.push(b);
              }
              deliveries.push({ method: prop, args: mArgs });
              return 'agent-silent';
            };
          }
          const value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      // CRITICAL: commands deliver through ctx.chat / ctx.bot, and those
      // contexts close over the api instance they were built with. Rebuild
      // them on the silent proxy — otherwise chat-bound sends would bypass
      // interception and post directly to the chat.
      const silentChat = createChatContext(
        silentApi,
        ctx.event,
        '',
        null,
        ctx.native.platform,
      );
      const silentBot = createBotContext(silentApi, ctx.event);

      const onCommandCtx: OnCommandCtx = {
        ...ctx,
        api: silentApi,
        chat: silentChat,
        bot: silentBot,
        parsed: { name: key, args: rest },
        prefix: ctx.prefix ?? '',
        mod,
        options: OptionsMap.empty(),
      };

      try {
        await dispatchCommand(
          { name: key, args: rest },
          onCommandCtx,
          silentApi,
          threadID,
          ctx.prefix ?? '',
        );

        // Merge intercepted deliveries into a single combined payload.
        const texts: string[] = [];
        const attachmentUrls: NamedUrlAttachment[] = [];
        const buttons: ButtonItem[][][] = [];
        for (const call of deliveries) {
          const opts =
            call.method === 'replyMessage' || call.method === 'editMessage'
              ? ((call.args[1] ?? {}) as Record<string, unknown>)
              : call.method === 'sendMessage' &&
                  call.args[0] !== null &&
                  typeof call.args[0] === 'object'
                ? (call.args[0] as Record<string, unknown>)
                : null;
          if (!opts) continue;
          const rawText = opts['message'];
          const text =
            typeof rawText === 'string'
              ? rawText
              : ((rawText as { message?: string } | undefined)?.message ??
                (rawText as { body?: string } | undefined)?.body);
          if (typeof text === 'string' && text.trim()) {
            texts.push(text.trim());
          }
          if (Array.isArray(opts['attachment_url'])) {
            for (const u of opts['attachment_url'] as NamedUrlAttachment[]) {
              if (u && typeof u.url === 'string') {
                attachmentUrls.push(u);
              }
            }
          }
          if (
            (call.method === 'replyMessage' || call.method === 'editMessage') &&
            buttons.length === 0 &&
            Array.isArray(opts['button']) &&
            (opts['button'] as unknown[]).length > 0
          ) {
            buttons.push(opts['button'] as ButtonItem[][]);
          }
        }

        const media: CommandRunMedia = {
          hasMedia:
            attachmentUrls.length > 0 || binaries.length > 0 || buttons.length > 0,
          attachmentUrls,
          binaries,
          buttons,
        };
        return {
          ok: true,
          output: texts.join('\n\n') || 'Done.',
          media,
        };
      } catch (err: unknown) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    // Continuity: before EVERY tool (internal and external MCP alike) the
    // progress reporter posts once and then edits its own message in place,
    // narrating the turn step by step. Best-effort â€” never fails the turn.
    // Assigned conditionally (exactOptionalPropertyTypes forbids `undefined`).
  };
  if (progress) {
    toolContext.onToolCall = async (toolName, isFirst, args) => {
      try {
        await progress.onToolCall(toolName, isFirst, args);
      } catch {
        // Cosmetic feedback only â€” swallow everything.
      }
    };
  }
  return toolContext;
}

// â”€â”€ Agent turn (personalityHandler.runAgent) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
      // errors silently (command.dispatcher.ts logs and returns) â€” if anything
      // unexpected fails mid-turn the user would see NOTHING. Reply with a
      // fallback so the agent can never go silent on an internal error.
      logger.error('[Agent] runAgent failed', { error: err });
      try {
        await ctx.chat.replyMessage({ message: pick(ERROR_REPLIES) });
      } catch {
        // Even the fallback failed â€” nothing more we can do.
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

  // Kick the image download off FIRST so it overlaps the identity/config
  // lookups below â€” the download (up to 10MB over HTTP) is the slowest
  // independent piece of turn setup.
  const imageDataPromise = resolveImageData(ctx);

  // Resolve everything the turn needs up front, in parallel: the per-user
  // config (LRU-cached 30s) plus the identity context for the system prompt
  // (nickname, sender name, sender role â€” all cached too). Nothing here
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

  // Image attachment â†’ passed to the LLM as vision input. The download was
  // started above so it already overlapped the identity lookups.
  const imageData = await imageDataPromise;

  // Nothing to work with â€” greet and open a session.
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
  // role, and the command prefix. The command catalogue is NOT inlined here â€”
  // the model discovers it once via list_commands and reuses it from history.
  // The prompt is intentionally STATIC (no datetime/model/provider) so the
  // system prompt + tool schemas stay byte-identical across turns, letting
  // providers prompt-cache the prefix instead of re-billing it. Per-turn
  // context (datetime, model, provider, mention hint) rides as a short context
  // line appended to the user message â€” failover attempts only change that
  // line, never the cached prefix.
  const systemPrompt = buildAgentSystemPrompt({
    botName: botNickname ?? displayName(config.agentName),
    userName,
    userRole,
    prefix: ctx.prefix ?? '/',
  });
  const turnContext = buildTurnContextLine({
    currentDatetime: formatLocalNow(config.timezone),
    mentioned,
  });

  const progress = createAgentProgress(ctx);
  const toolContext = buildToolContext(ctx, progress);
  // Spin up the in-process MCP server bound to this turn's context â€” the
  // runner lists schemas and executes tool calls through the MCP protocol.
  const tools = await createMcpToolSet(toolContext);
  const threadQuery = imageData
    ? query
      ? `[Image] ${query}`
      : '[Image]'
    : query;

  logger.info('[Agent]', `${senderID} â†’ ${query.slice(0, 80)}`);

  try {
    const result = await runAgentTurnWithFailover(
      key.userId || undefined,
      {
        provider: config.provider,
        apiKey: config.apiKey,
        model: config.model,
      },
      {
        history,
        userQuery: `${query || '[Describe this image]'}\n\n${turnContext}`,
        tools,
        context: toolContext,
        imageData,
        maxToolIterations: config.maxToolIterations,
      },
      systemPrompt,
    );

    activateSession(key);
    const threadLimits = {
      maxHistory: config.maxHistory,
      ttlSeconds: config.threadTtl,
    };

    // The send_result tool already delivered the reply (synthesized text +
    // attachments/buttons) via its own platform call â€” never double-post the
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

    // Priority 1: bot command â€” it already ran SILENTLY (runBotCommand
    // intercepts every delivery), so the whole output â€” text, media, buttons â€”
    // is merged into ONE message here. The status bubble is edited into that
    // combined message; if the platform cannot edit it, one fresh combined
    // message is sent instead and the placeholder is unsent by the finally.
    if (result.commandToExecute) {
      const rawCommand = result.commandToExecute.trim();
      const cmdLabel = rawCommand.replace(/^\//, '').split(/\s+/)[0] || 'command';
      const { ok, output, error, media } = await toolContext.runBotCommand(
        rawCommand,
      );
      const threadAssistant = ok
        ? `[Executed command: ${rawCommand} â†’ ${output ?? 'Done.'}]`
        : `[Command failed: ${rawCommand} â†’ ${error ?? 'unknown error'}]`;
      if (ok) {
        const body = output?.trim() ?? '';
        const message =
          media?.hasMedia && body
            ? `Here's your ${cmdLabel}:\n\n${body}`
            : body || `âœ… Executed /${cmdLabel}`;
        const totalAttachments =
          (media?.attachmentUrls.length ?? 0) + (media?.binaries.length ?? 0);
        const editOptions: EditMessageOptions = {
          message,
          ...(media?.attachmentUrls.length
            ? { attachment_url: media.attachmentUrls }
            : {}),
          ...(media?.binaries.length ? { attachment: media.binaries } : {}),
          ...(media && media.buttons.length > 0 && totalAttachments <= 1
            ? { button: media.buttons[0] }
            : {}),
        };
        const edited = await progress.editWithOptions(editOptions);
        if (!edited) {
          // Platform cannot edit the placeholder into media/text â€” send ONE
          // fresh combined message instead; the placeholder is unsent by the
          // finally below, so the user still sees exactly one reply.
          try {
            await ctx.api.replyMessage(threadID, {
              style: MessageStyle.TEXT,
              message,
              ...(media?.attachmentUrls.length
                ? { attachment_url: media.attachmentUrls }
                : {}),
              ...(media?.binaries.length
                ? { attachment: media.binaries }
                : {}),
              ...(media && media.buttons.length > 0 && totalAttachments <= 1
                ? { button: media.buttons[0] }
                : {}),
            });
          } catch {
            await ctx.chat.replyMessage({
              style: MessageStyle.TEXT,
              message,
            });
          }
        }
        appendThread(key, threadQuery, threadAssistant, threadLimits);
      } else {
        // The command never produced output â€” repurpose the status message
        // into the failure note instead of posting a second bubble.
        const edited = await progress.finishWithText(
          `hmm, couldn't run "${rawCommand}" ðŸ¤” try asking differently`,
          false,
        );
        if (!edited) {
          await ctx.chat.replyMessage({
            message: `hmm, couldn't run "${rawCommand}" ðŸ¤” try asking differently`,
          });
        }
        appendThread(key, threadQuery, threadAssistant, threadLimits);
      }
      return;
    }

    // Priority 2: media fallback â€” the model ran test_command (capturing
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
        message: caption ?? 'Here you go! ðŸŽ‰',
        attachment_url: capturedMedia.attachmentUrlKeys,
        button: capturedMedia.buttonKeys,
        attachment: capturedMedia.binaryKeys,
      });
      const threadAssistant = buildThreadEntry(
        result.toolLog,
        caption && !looksLikeRawToolDump(caption) ? caption : null,
      );
      appendThread(key, threadQuery, threadAssistant, threadLimits);
      // Only short-circuit when delivery actually succeeded â€” a failed delivery
      // falls through to the plain-text path so the user still gets a reply.
      if (!status.startsWith('Delivery failed')) return;
    }

    if (!result.text) {
      // Nothing came back â€” clear the placeholder before the error reply so
      // the user sees exactly one clean message.
      await progress.dispose();
      await ctx.chat.replyMessage({ message: pick(ERROR_REPLIES) });
      return;
    }

    // Never surface a raw test_command JSON dump as the reply (e.g. when the model
    // tested a text-only command but failed to deliver). Replace it with the
    // command's own caption or a neutral fallback.
    const replyText = looksLikeRawToolDump(result.text)
      ? (extractCapturedCaption(result.toolLog) ?? 'Here you go! ðŸŽ‰')
      : result.text;

    // Concise assistant thread entry: one-line tool summary + the delivered
    // reply, so history stays small and the next turn keeps full context.
    const threadAssistant = buildThreadEntry(result.toolLog, replyText);

    // Always deliver the final answer as Markdown. The Telegram adapter
    // sanitizes the text into MarkdownV2 (escaping reserved characters), so a
    // constant MARKDOWN style is safe even for plain conversational replies.
    // If a styled send is rejected anyway (strict parsers, unbalanced model
    // syntax), retry once as plain text so the content still reaches the user
    // instead of going silent.
    //
    // Continuity: when a status message exists, the FINAL ANSWER is edited into
    // that same message — the exact bubble that narrated each step becomes the
    // answer. Only when there is nothing to edit (no tools ran) does this fall
    // back to sending a fresh reply.
    const editedIntoStatus = await progress.finishWithText(replyText, true);
    if (!editedIntoStatus) {
      try {
        await ctx.chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: replyText,
        });
      } catch (sendErr) {
        logger.debug('[Agent] styled reply rejected â€” retrying as plain text', {
          error: sendErr,
        });
        await ctx.chat.replyMessage({
          style: MessageStyle.TEXT,
          message: replyText,
        });
      }
    }
    appendThread(key, threadQuery, threadAssistant, threadLimits);
  } finally {
    // If anything above threw mid-turn (provider outage, dispatch crash), the
    // placeholder must not linger as "â³ â€¦" forever.
    void progress.dispose();
  }
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

// â”€â”€ Access guard (maintenance / admin-only modes) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Enforces the same restriction modes the command middleware applies, for the
 * natural-language agent path (which never passes through the dispatcher):
 *
 *   1. Maintenance Mode   (global)      â†’ System Admins only
 *   2. Bot Admin Only     (session-wide) â†’ bot admins only
 *   3. Group Admin Only   (per-thread)   â†’ group / bot / system admins only
 *
 * Mirrors enforceMaintenanceMode + enforceAdminOnly in on-command.middleware.ts
 * (same messages, same LRU fast-path caches, same 15s notification dedup) so
 * the AI respects these modes exactly like every command does. The per-command
 * ignore lists do NOT apply here â€” the natural-language agent is not a command,
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

  // â”€â”€ 1. Maintenance Mode â€” global, System Admins only â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
              'ðŸš« The bot is under maintenance â€” only System Admins may use commands right now.',
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
  // known-off (populated on the first check per session/thread) â€” the common
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

  // â”€â”€ 2. Session-wide Bot Admin Only (db.bot â†’ session_settings) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                    'ðŸš« The bot is currently in admin-only mode. Only bot admins may use commands.',
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

  // â”€â”€ 3. Per-thread Group Admin Only (db.threads â†’ adminbox_settings) â”€â”€â”€â”€â”€â”€â”€â”€
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
                  message: 'ðŸš« Only group admins can use the bot in this thread.',
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

// â”€â”€ Natural-language activation (canis message.ts) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Runs on every non-command message (onChat). Continues an active session,
 * then triggers on the agent name word or a bot @mention â€” mirroring canis's
 * message.ts AI routing. The maintenance / admin-only guards run first, so a
 * restricted bot never answers natural-language messages.
 */
export async function maybeRunAgentOnChat(ctx: BaseCtx): Promise<void> {
  const body = (ctx.event['message'] ?? ctx.event['body'] ?? '') as string;
  if (!body) return;

  // Never answer the bot's OWN messages â€” platforms that echo the bot's posts
  // back through the message pipeline (e.g. userbot setups) would otherwise
  // re-trigger the agent on its own reply and double-respond.
  try {
    const botID = await ctx.api.getBotID();
    const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string;
    if (botID && senderID && String(senderID) === String(botID)) return;
  } catch {
    // Bot ID unavailable â€” fail-open and continue.
  }

  // Skip command invocations â€” commands are handled by the dispatcher and
  // must never be hijacked by natural-language activation.
  const prefix = ctx.prefix ?? '';
  if (prefix && body.trim().startsWith(prefix)) return;

  const key = buildAgentKey(ctx);
  if (!key.senderID || !key.threadID) return;

  // Maintenance / Bot Admin Only / Group Admin Only gates â€” when any is on,
  // non-privileged senders are blocked (with a throttled notice) before the
  // session continuation, trigger word, or @mention can fire.
  if (!(await enforceAgentAccess(ctx))) return;

  // 1. Active session â†’ continue the conversation without a trigger word.
  if (isSessionActive(key)) {
    await runAgentWithIndicator(ctx);
    return;
  }

  // 2. Trigger word in the body (whole-word match) â€” the web-configured agent
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
    // Telegram: bot is mentioned by @username (mention entity) â€” compare to
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
      // Bot ID unavailable â€” fall through.
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
  await ctx.chat.replyMessage({ message: 'done, fresh start ðŸ§¹' });
}

// â”€â”€ Simple completion with caching (canis agentHandler) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * One-shot, no-tools completion with prompt caching â€” the canis agentHandler
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
    const result = await runAgentTurnWithFailover(
      ctx.native.userId,
      {
        provider: config.provider,
        apiKey: config.apiKey,
        model: config.model,
      },
      {
        history: [],
        userQuery: prompt,
        // No tools â€” an empty MCP tool set (schemas: [] means the LLM gets no
        // function declarations, and callTool is never reached).
        tools: {
          schemas: [],
          callTool: async () => '(no tools available)',
        },
        // No tools are passed to this completion, so the context is never used
        // for tool execution â€” only the helper surface matters here.
        context: {
          getUserInfo: async () => null,
          getThreadInfo: async () => null,
          listCommands: async () => '{}',
          runBotCommand: async () => ({ ok: false, error: 'Not available' }),
        } as unknown as ToolContext,
      },
      'You are a helpful AI assistant. Today is %TODAY%.'.replace(
        '%TODAY%',
        today,
      ),
    );
    if (result.text) cacheResult(prompt, today, result.text);
    return result.text;
  } catch (err) {
    logger.error('[Agent] generateSimpleText failed', err);
    return null;
  }
}
