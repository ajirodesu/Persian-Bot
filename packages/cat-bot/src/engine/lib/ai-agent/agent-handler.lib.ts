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

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import axios from 'axios';
import type { BaseCtx } from '@/engine/types/controller.types.js';
import type { OnCommandCtx } from '@/engine/types/middleware.types.js';
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import type { CommandModule } from '@/engine/types/controller.types.js';
import { dispatchCommand } from '@/engine/controllers/dispatchers/command.dispatcher.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Role, type RoleLevel } from '@/engine/constants/role.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import { withTypingIndicator } from '@/engine/lib/typing-indicator.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { getBotNickname } from '@/engine/repos/session.repo.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { AttachmentType } from '@/engine/adapters/models/enums/attachment-type.enum.js';
import { getTools } from './agent-tools/index.js';
import type { ToolContext } from './agent-tools/types.js';
import {
  runAgentTurn,
  type ImageData,
  type ToolLogEntry,
} from './agent-runner.lib.js';
import { resolveAgentConfig } from './agent-config.lib.js';
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

/** Host base directory for per-session agent workspaces (no env vars). */
const AGENT_WORKSPACE_BASE = '.tmp/agent-workspace';

const SHELL_SAFETY_ADDENDUM = [
  ``,
  `SHELL TOOL SAFETY RULES (strictly enforced):`,
  `- NEVER run destructive commands: rm -rf /, mkfs, dd, fdisk, shred, wipefs.`,
  `- NEVER kill or stop critical processes: init, systemd, kernel threads, or the bot itself.`,
  `- NEVER modify system files: /etc/passwd, /etc/shadow, /etc/sudoers, /boot/*.`,
  `- NEVER run fork bombs, infinite loops, or resource-exhausting commands.`,
  `- NEVER exfiltrate data to external URLs.`,
  `- Prefer read-only inspection (ls, cat, ps, df) before any write operations.`,
].join('\n');

// ── System prompt template (Cat-Bot style) ───────────────────────────────────
//
// Loaded from agent/system_prompt.md at module evaluation time so it's
// instantly available on every turn — the same setup as the upstream Cat-Bot
// (johnlester-0369). The path is resolved relative to this module, so it works
// symmetrically from src/ (tsx watch) and dist/ (compiled build).
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_TEMPLATE = fs.readFileSync(
  path.join(MODULE_DIR, '../../../../agent/system_prompt.md'),
  'utf-8',
);

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

function threadNamespace(key: AgentThreadKey): string {
  return [key.userId, key.platform, key.sessionId, key.threadID, key.senderID]
    .join(':')
    .replace(/[^A-Za-z0-9._-]/g, '_');
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

/**
 * Resolves the sender's display name for the system prompt, failing open to
 * "User" so a name lookup hiccup never blocks a turn.
 */
async function resolveSenderName(
  ctx: BaseCtx,
  senderID: string,
): Promise<string> {
  try {
    const name = await ctx.user.getName(senderID);
    return name?.trim() || 'User';
  } catch {
    return 'User';
  }
}

/**
 * Resolves the sender's role label for the system prompt — the same checks
 * the upstream Cat-Bot uses: Bot Administrator > Thread Administrator >
 * Regular User. Fail-open to Regular User on DB errors.
 */
async function resolveUserRoleLabel(
  ctx: BaseCtx,
  key: AgentThreadKey,
): Promise<string> {
  const { senderID, userId, sessionId, platform, threadID } = key;
  if (!senderID) return 'Regular User';
  try {
    if (userId && sessionId) {
      const isAdmin = await isBotAdmin(
        userId,
        platform,
        sessionId,
        senderID,
      );
      if (isAdmin) return 'Bot Administrator';
    }
    if (threadID) {
      const isThreadAdm = await isThreadAdmin(threadID, senderID);
      if (isThreadAdm) return 'Thread Administrator';
    }
  } catch {
    // Fail-open — a temporary DB outage defaults to Regular User.
  }
  return 'Regular User';
}

/**
 * Builds the `<available_commands>` list — commands grouped by category and
 * sorted, so the LLM sees domain structure (the same approach as upstream
 * Cat-Bot) instead of a flat alphabetical list.
 */
function buildAvailableCommandsList(
  commands: Map<string, CommandModule>,
  platform: string,
): string {
  const byCategory = new Map<string, string[]>();
  const seen = new Set<CommandModule>();
  for (const [name, mod] of commands) {
    // Deduplicate aliases — the command map stores one entry per name AND per
    // alias key; only the canonical module counts once.
    if (seen.has(mod)) continue;
    seen.add(mod);
    if (!isPlatformAllowed(mod, platform)) continue;
    const meta = (mod['meta'] ?? {}) as {
      name?: string;
      category?: string;
    };
    const cmdName = (meta.name ?? name).toLowerCase();
    const category = meta.category?.trim() || 'Uncategorized';
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push(cmdName);
  }
  return [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, cmds]) => `${cat}: ${[...cmds].sort().join(', ')}`)
    .join('\n');
}

/**
 * Fills the Cat-Bot system-prompt template (agent/system_prompt.md) with the
 * per-turn context: the bot's name, the sender's name/role, the command
 * prefix, the available commands, and the current time in the user's
 * timezone. Mention and shell-safety hints are appended on top.
 */
function buildSystemPrompt(params: {
  mentioned: boolean;
  shellEnabled: boolean;
  timeZone: string;
  botName: string;
  userName: string;
  userRole: string;
  prefix: string;
  availableCommands: string;
}): string {
  let prompt = SYSTEM_PROMPT_TEMPLATE
    .replaceAll('{{BOT_NAME}}', params.botName)
    .replaceAll('{{USER_NAME}}', params.userName)
    .replaceAll('{{USER_ROLE}}', params.userRole)
    .replaceAll('{{COMMAND_PREFIX}}', params.prefix)
    .replaceAll('{{AVAILABLE_COMMANDS}}', params.availableCommands || '(none)')
    .replaceAll('{{CURRENT_DATETIME}}', formatLocalNow(params.timeZone));
  if (params.mentioned) {
    prompt +=
      '\n\nThe user has mentioned people in this message — you can @mention them in your reply.';
  }
  if (params.shellEnabled) {
    prompt += '\n' + SHELL_SAFETY_ADDENDUM;
  }
  return prompt;
}

function buildToolSummary(toolLog: ToolLogEntry[]): string {
  if (!toolLog.length) return '';
  const lines = toolLog.map((t) => {
    const argsStr = Object.values(t.args)
      .map((v) => String(v))
      .join(', ')
      .slice(0, 80);
    return `• ${t.name}(${argsStr}) → ${t.result.slice(0, 200)}`;
  });
  return `[Tools used this turn:\n${lines.join('\n')}]\n\n`;
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

/** Role labels exposed to the LLM (canis's user/admin/super-admin taxonomy). */
function roleLabel(level: RoleLevel | undefined): string {
  switch (level) {
    case Role.PREMIUM:
      return 'premium';
    case Role.THREAD_ADMIN:
    case Role.BOT_ADMIN:
      return 'admin';
    case Role.SYSTEM_ADMIN:
      return 'super-admin';
    default:
      return 'user';
  }
}

function roleMatchesFilter(
  level: RoleLevel | undefined,
  filter: string,
): boolean {
  const label = roleLabel(level);
  if (filter === 'all') return true;
  if (filter === 'admin') return label === 'admin' || label === 'super-admin';
  if (filter === 'super-admin') return label === 'super-admin';
  if (filter === 'premium') return label === 'premium';
  return label === 'user'; // 'user' filter → ANYONE commands only
}

function buildToolContext(ctx: BaseCtx, workspaceDir: string): ToolContext {
  const threadID = (ctx.event['threadID'] as string) ?? '';

  // Spread the live bot context into the tool context — ToolContext extends
  // BaseCtx so command-aware tools (help, test_command, send_result) can reach
  // api, event, commands, prefix and native directly, while the helper surface
  // below stays available to the file/browser/shell tools.
  return {
    ...ctx,
    workspaceDir,

    sendFile: async (filePath: string, caption?: string): Promise<string> => {
      try {
        // Relative paths resolve inside the per-session workspace (the shell
        // tool's CWD); absolute paths are used as-is.
        const hostPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(workspaceDir, filePath);
        if (!fs.existsSync(hostPath)) {
          return (
            `Error: file not found at ${hostPath}. ` +
            'Use the shell tool to create it in the workspace first, then call send_file again.'
          );
        }
        const name = path.basename(hostPath);
        await ctx.chat.replyMessage({
          message: caption ? `📎 *${caption}*` : '',
          attachment: [{ name, stream: fs.createReadStream(hostPath) }],
        });
        logger.info('[Agent]', `send_file → ${hostPath}`);
        return 'File sent successfully.';
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error('[Agent] send_file failed', err);
        return `Error sending file: ${errMsg}. Fix the issue and try send_file again.`;
      }
    },

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

    listCommands: async (role = 'all') => {
      const MAX_OUTPUT = 2000;
      const result: Record<
        string,
        { description: string; usage: string; role: string }
      > = {};
      const seen = new Set<CommandModule>();
      for (const [name, mod] of ctx.commands) {
        if (seen.has(mod)) continue;
        seen.add(mod);
        const cfg = (mod['meta'] ?? {}) as {
          name?: string;
          description?: string;
          usage?: string | string[];
          role?: RoleLevel;
        };
        const label = roleLabel(cfg.role);
        if (role !== 'all' && !roleMatchesFilter(cfg.role, role)) continue;
        const usage = Array.isArray(cfg.usage)
          ? cfg.usage.join(' | ')
          : (cfg.usage ?? '');
        result[cfg.name ?? name] = {
          description: cfg.description ?? '',
          usage,
          role: label,
        };
      }
      return JSON.stringify(result).slice(0, MAX_OUTPUT);
    },

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
 * file sending, and vision input. Commands pass an explicit query override
 * (the event body still carries the command prefix + name); plain-chat
 * activation reads the raw body, stripping a leading "<agent-name> " prefix.
 */
export async function runAgent(
  ctx: BaseCtx,
  queryOverride?: string,
): Promise<void> {
  const key = buildAgentKey(ctx);
  const { threadID, senderID } = key;
  if (!senderID || !threadID) return;

  const workspaceDir = path.join(AGENT_WORKSPACE_BASE, threadNamespace(key));

  // Resolve the per-user config up front (LRU-cached 30s) — it feeds the
  // trigger-name strip, the system prompt, tool gating and turn limits below.
  const config = await resolveAgentConfig(key.userId || undefined);
  const botNickname = await resolveBotNickname(ctx);

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

  const tools = getTools(config.shellEnabled);
  // Cat-Bot style personalization: fill the system-prompt template with the
  // bot's name (session nickname or trigger word), the sender's name + role,
  // the command prefix, and the available commands grouped by category.
  const systemPrompt = buildSystemPrompt({
    mentioned,
    shellEnabled: config.shellEnabled,
    timeZone: config.timezone,
    botName: botNickname ?? displayName(config.agentName),
    userName: await resolveSenderName(ctx, senderID),
    userRole: await resolveUserRoleLabel(ctx, key),
    prefix: ctx.prefix ?? '/',
    availableCommands: buildAvailableCommandsList(
      ctx.commands,
      key.platform,
    ),
  });

  fs.mkdirSync(workspaceDir, { recursive: true });

  const toolContext = buildToolContext(ctx, workspaceDir);
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
  // turn's final text on top of it.
  const deliveredViaSendResult = result.toolLog.some(
    (t) => t.name === 'send_result',
  );
  if (deliveredViaSendResult) {
    appendThread(
      key,
      threadQuery,
      buildToolSummary(result.toolLog) + (result.text ?? ''),
      threadLimits,
    );
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

  if (!result.text) {
    await ctx.chat.replyMessage({ message: pick(ERROR_REPLIES) });
    return;
  }

  // Prepend tool summary to the assistant thread entry so the next turn has full context.
  const threadAssistant = buildToolSummary(result.toolLog) + result.text;

  // AI replies are always delivered as markdown — the model is prompted to
  // format with bold/lists/code blocks, and every platform renders them
  // (webchat + Discord native, Telegram MarkdownV2, Fluxer native markdown).
  await ctx.chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: result.text,
  });
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

// ── Natural-language activation (canis message.ts) ────────────────────────────

/**
 * Runs on every non-command message (onChat). Continues an active session,
 * then triggers on the agent name word or a bot @mention — mirroring canis's
 * message.ts AI routing.
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
      tools: [],
      // No tools are passed to this completion, so the context is never used
      // for tool execution — only the helper surface matters here.
      context: {
        workspaceDir: path.join(AGENT_WORKSPACE_BASE, 'simple'),
        sendFile: async () => 'File sending is not available.',
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
