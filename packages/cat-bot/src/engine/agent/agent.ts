import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Groq, { APIError, RateLimitError } from 'groq-sdk';
import type { AppCtx } from '@/engine/types/controller.types.js';
import {
  resolveAgentContext,
  extractHumanText,
  renderSystemPrompt,
  describeUserMedia,
  getPendingMedia,
  clearPendingMedia,
  deliverAgentMedia,
} from '@/engine/agent/agent.util.js';
import type { AgentTool } from '@/engine/agent/agent.util.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { getUserGroqApiKey } from '@/engine/repos/groq-key.repo.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import {
  initAgentStatus,
  setAgentStatus,
  describeToolStatus,
  DEFAULT_AGENT_STATUS_TEXT,
} from '@/engine/agent/lib/agent-status.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// ============================================================================
// PROMPT TEMPLATE
// ============================================================================
// Load synchronously at module evaluation time so it is instantly available
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Read prompt from relocated agent directory (works symmetrically from src/ and dist/ contexts)
const SYSTEM_PROMPT_TEMPLATE = fs.readFileSync(
  path.join(__dirname, '../../../agent/system_prompt.md'),
  'utf-8',
);

// ============================================================================
// GROQ CLIENT FACTORY
// ============================================================================
// Every AI request must use the *requesting user's own* Groq API key — the key is
// resolved per invocation from the authenticated account id (see runAgent below)
// and a fresh Groq client is built from it. There is deliberately NO process-wide
// singleton here: the platform key (env GROQ_API_KEY) was previously shared by
// every user, which violates the per-user ownership requirement. Building a client
// per turn is negligible (the SDK client is a stateless config wrapper).
/** Maximum bot commands a non-system-admin user may request per agent invocation. */
export const AGENT_COMMAND_LIMIT = 5;

function createGroq(apiKey: string): Groq {
  return new Groq({ apiKey });
}

// Hard ceiling for a single Groq completion — the SDK's own default is 10
// minutes, far too long for the model step of an agent turn. A stalled network
// request must not pin the turn (and the user's typing indicator) indefinitely.
const GROQ_REQUEST_TIMEOUT_MS = 90_000;

// Ceiling for a single non-test_command tool call. test_command is exempt: it
// self-limits with its own 10-minute race designed for long-running commands
// (network-heavy image/media fetches). Every other tool (browser, get_user,
// get_group, help, …) must not hang the agent loop past this bound.
const TOOL_TIMEOUT_MS = 60_000;

/**
 * Races a promise against a hard timeout, resolving/rejecting with the winner.
 * The underlying promise keeps running in the background if it loses the race
 * (its result is discarded) — same trade-off as test_command's internal timer.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${Math.round(ms / 1000)}s and was abandoned.`,
        ),
      );
    }, ms);
    (timer as NodeJS.Timeout).unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// ============================================================================
// GROQ "json" TOOL-CALL QUIRK RECOVERY
// ============================================================================
// Groq's openai/gpt-oss-120b occasionally emits a synthetic tool call literally
// named "json" (instead of the real tool name) when it produces what looks like
// a final structured answer — the model's Harmony-format "commentary/final json"
// channel leaking through the OpenAI-compatible tool-calling shim. Groq validates
// tool-call names SERVER-SIDE against the requested `tools` list and rejects the
// *entire* completion with a 400 ("tool_use_failed") when the name doesn't match
// — even though the arguments the model generated are a perfectly valid call to
// one of our real tools. Because the rejection happens before the SDK returns a
// normal response, we can't intercept it in the usual tool-dispatch loop below;
// we have to catch the thrown error, recover the intended call from the error
// body's `failed_generation` field, and splice it back into the conversation as
// if Groq had returned it normally.
//
// Only "json" → "send_result" is aliased for now: it's the only observed case,
// and send_result is the sole tool whose argument shape (`message`, plus optional
// `attachment_url` / `attachment` / `button`) matches what the model emits under
// the bogus "json" name.
const TOOL_NAME_ALIASES: Record<string, string> = {
  json: 'send_result',
};

interface RecoveredToolCall {
  name: string;
  arguments: string;
}

/**
 * Attempts to pull `{ name, arguments }` out of a Groq APIError's
 * `error.error.failed_generation` field (the raw JSON text the model produced
 * for the tool call Groq refused to accept). Returns null for any error shape
 * that doesn't match — callers should rethrow the original error in that case.
 */
function extractFailedToolGeneration(err: unknown): RecoveredToolCall | null {
  const failedGeneration = (
    err as {
      error?: { error?: { code?: string; failed_generation?: string } };
    }
  )?.error?.error;
  if (
    failedGeneration?.code !== 'tool_use_failed' ||
    typeof failedGeneration.failed_generation !== 'string'
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(failedGeneration.failed_generation) as {
      name?: string;
      arguments?: unknown;
    };
    if (!parsed || typeof parsed.name !== 'string') return null;
    return {
      name: parsed.name,
      arguments:
        typeof parsed.arguments === 'string'
          ? parsed.arguments
          : JSON.stringify(parsed.arguments ?? {}),
    };
  } catch {
    return null;
  }
}

/**
 * Thrown by runAgent when the account's Groq API key has exhausted its rate
 * limit (HTTP 429). Callers distinguish this from a generic AI failure so they
 * can surface a friendly rate-limit notice instead of a raw API error.
 */
export class AgentRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentRateLimitError';
  }
}

/**
 * Detects the SDK's rate-limit error type — or any Groq APIError with HTTP 429,
 * so detection stays robust even if a duplicate copy of the SDK ends up bundled.
 */
function isGroqRateLimitError(err: unknown): boolean {
  if (err instanceof RateLimitError) return true;
  return err instanceof APIError && err.status === 429;
}

// ============================================================================
// MODULAR TOOL LOADER
// ============================================================================

// Use the SDK's own type for the cached descriptor array so assignment to
// groq.chat.completions.create({ tools }) satisfies TypeScript without casting.
type GroqTool = Groq.Chat.Completions.ChatCompletionTool;

let cachedTools: AgentTool[] | null = null;
/** Pre-built Groq-API-shaped tool descriptors — derived once from cachedTools. */
let cachedGroqTools: GroqTool[] | null = null;
/** O(1) name→tool lookup — replaces the O(n) Array.find() on every tool call. */
let cachedToolsMap: Map<string, AgentTool> | null = null;

// ============================================================================
// COMMAND LIST CACHE
// ============================================================================
// Building + sorting the available-commands list is O(n·log n) over all
// registered commands and happens on EVERY runAgent call.  Since the command
// registry is static after boot (commands are loaded once), the result is
// identical for the same platform across all calls.  Cache it per platform so
// the work is done exactly once per platform, not once per message.
const availableCommandsCache = new Map<string, string>();

/**
 * Dynamically loads agent tools from the tools/ directory.
 * Mirrors the architecture of the command dispatcher for modularity.
 * Caches the resolved tools for the lifecycle of the process.
 */
export async function loadAgentTools(): Promise<AgentTool[]> {
  if (cachedTools) return cachedTools;

  const tools: AgentTool[] = [];
  const dir = path.join(__dirname, 'tools');

  if (!fs.existsSync(dir)) {
    cachedTools = [];
    cachedGroqTools = [];
    cachedToolsMap = new Map();
    return cachedTools;
  }

  // Allow loading .ts files during local dev via tsx, whilst ignoring compiled type definitions
  const files = (await fs.promises.readdir(dir)).filter(
    (f) => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts'),
  );

  for (const file of files) {
    try {
      const mod = (await import(
        pathToFileURL(path.join(dir, file)).href
      )) as AgentTool;

      // Ensure the loaded module implements the AgentTool interface properly
      if (mod.config && typeof mod.run === 'function') {
        tools.push(mod);
      }
    } catch (err) {
      logger.error(`[Agent] Failed to load tool ${file}`, { error: err });
    }
  }

  cachedTools = tools;
  // Derive O(1) lookup map and pre-built Groq descriptors once, reuse forever.
  cachedToolsMap = new Map(tools.map((t) => [t.config.name, t]));
  cachedGroqTools = tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.config.name,
      description: t.config.description,
      parameters: t.config.parameters,
    },
  }));
  return cachedTools;
}

// =========================
// 🚀 AGENT LOOP ENGINE
// =========================
/**
 * Runs the ReAct-style agent loop, resolving tool calls recursively until a
 * final text answer is produced or the turn limit is reached.
 *
 * The Groq API key is ALWAYS the calling user's own (resolved from the bot
 * session's account id). Callers that already resolved the key (e.g. the ai
 * command's friendly pre-flight check) can pass it via `groqApiKey` to avoid a
 * second DB read; when omitted it is resolved here. If the account has no key,
 * AI is disabled and a clear error is thrown.
 */
export async function runAgent(
  userInput: string,
  ctx: AppCtx,
  nickname?: string | null,
  userName?: string | null,
  systemPromptOverride?: string | null,
  groqApiKey?: string | null,
): Promise<string> {
  // ── Per-user Groq API key ──────────────────────────────────────────────────
  // AI requests must use the configured key of the account that owns the bot.
  // No key → AI is disabled; the caller surfaces a friendly notice.
  const { senderID, threadID, sessionUserId, sessionId, platform } =
    resolveAgentContext(ctx);

  let apiKey = groqApiKey ?? null;
  if (!apiKey) {
    apiKey = sessionUserId ? await getUserGroqApiKey(sessionUserId) : null;
  }
  if (!apiKey) {
    throw new Error(
      'AI is disabled — no Groq API key is configured for this account. ' +
        'Add your key in Dashboard → Settings to enable AI.',
    );
  }
  const groq = createGroq(apiKey);

  // Live status ref, read by withThinkingIndicator's refresh loop so the
  // "bot is typing/thinking" signal reflects the agent's actual current
  // action instead of a generic placeholder for the whole turn.
  initAgentStatus(ctx);

  // Fresh per-turn media accumulator — test_command pushes captured
  // image/video/audio here, send_result merges it automatically, and the
  // bare-text fallback below delivers it as a last resort.
  clearPendingMedia(ctx);

  // loadAgentTools() is idempotent and returns the cached list after the first call.
  // cachedGroqTools and cachedToolsMap are populated in the same call — safe to use directly.
  await loadAgentTools();
  if (!cachedGroqTools) {
    throw new Error('Agent tools failed to load — AI is unavailable.');
  }
  const groqTools = cachedGroqTools;

  // ── Role + exemption checks (parallel) ─────────────────────────────────────
  // isBotAdmin (role label + command-limit exemption), isSystemAdmin (limit
  // exemption) and isThreadAdmin (role label fallback) are independent reads —
  // resolving them concurrently collapses up to three sequential DB round-trips
  // into one. Fail-open on every check: a DB error defaults to Regular User and
  // the limit still applies.
  let userRoleLabel = 'Regular User';
  const [_isBotAdmin, threadAdmin, _isSysAdmin] = await Promise.all([
    senderID && sessionUserId && sessionId
      ? isBotAdmin(sessionUserId, platform, sessionId, senderID).catch(
          () => false,
        )
      : Promise.resolve(false),
    senderID && threadID
      ? isThreadAdmin(threadID, senderID).catch(() => false)
      : Promise.resolve(false),
    senderID
      ? isSystemAdmin(senderID).catch(() => false)
      : Promise.resolve(false),
  ]);
  if (_isBotAdmin) {
    userRoleLabel = 'Bot Administrator';
  } else if (threadAdmin) {
    userRoleLabel = 'Thread Administrator';
  }

  // ── Per-message agent command limit ──────────────────────────────────────────
  // Attach a mutable budget object to ctx before the tool loop. test_command reads
  // this to enforce the cap and trim/reject excess commands within a single agent run.
  // Exempt for BOTH global System Admins (isSystemAdmin — cross-session, dashboard-
  // managed) AND this session's Bot Administrator (isBotAdmin — the bot's own
  // owner/admin, who already bypasses bans and cooldowns in agent-command-guard.lib.ts).
  // No budget is attached for either — unconditional exemption, not a higher limit.
  // Fail-open: if a check throws, treat that check as non-admin (limit still applies
  // unless the OTHER check independently grants the exemption).
  const _isExemptFromCommandLimit = _isSysAdmin || _isBotAdmin;
  if (!_isExemptFromCommandLimit) {
    (ctx as unknown as Record<string, unknown>)['_agentCommandBudget'] = {
      used: 0,
      limit: AGENT_COMMAND_LIMIT,
    };
  }

  // Group commands by category so the system prompt exposes domain structure to the LLM.
  // A flat alphabetical list gives no signal about which commands belong together;
  // category grouping lets the model pick the right command family before calling help().
  //
  // The command registry is static after boot — cache the sorted result per platform
  // so the O(n·log n) build+sort runs once per platform, not once per message.
  let availableCommandsList = availableCommandsCache.get(platform);
  if (availableCommandsList === undefined) {
    const commandsByCategory = new Map<string, string[]>();
    const seenCmdNames = new Set<string>();
    for (const mod of ctx.commands.values()) {
      const cfg = mod['meta'] as {
        name?: string;
        category?: string;
      } | undefined;
      if (cfg?.name && isPlatformAllowed(mod, platform)) {
        const cmdName = cfg.name.toLowerCase();
        // Deduplicate aliases — CommandMap stores one entry per name AND per alias key;
        // seenCmdNames ensures each canonical command name appears exactly once per category,
        // mirroring the getCanonicalMods() deduplication pattern used in help.ts.
        if (seenCmdNames.has(cmdName)) continue;
        seenCmdNames.add(cmdName);
        const category = cfg.category ?? 'Uncategorized';
        if (!commandsByCategory.has(category)) commandsByCategory.set(category, []);
        commandsByCategory.get(category)!.push(cmdName);
      }
    }
    // Sort categories and their commands alphabetically — deterministic ordering prevents
    // the LLM from seeing a shuffled list on each turn, which would cause inconsistent
    // tool selection across otherwise identical conversational prompts.
    availableCommandsList = Array.from(commandsByCategory.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, cmds]) => `${cat}: ${cmds.sort().join(', ')}`)
      .join('\n');
    availableCommandsCache.set(platform, availableCommandsList);
  }

  // Mirror the exemption computed above: no budget was attached for System Admins
  // or Bot Administrators, so the prompt should say so plainly rather than quoting
  // a numeric cap that doesn't actually apply to this user.
  const agentCommandLimitNote = _isExemptFromCommandLimit
    ? `As ${_isSysAdmin ? 'a System Administrator' : 'this bot\'s Administrator'}, you are not subject to a per-message command limit.`
    : `You may run at most ${AGENT_COMMAND_LIMIT} commands total per user message ` +
      `(across all \`test_command\` calls combined). This is a hard limit — it cannot ` +
      `be increased or bypassed for this user.`;

  // Single-pass substitution replaces EVERY occurrence of each placeholder
  // (the old per-variable .replace() only handled the first, leaking literal
  // {{BOT_NAME}}/{{USER_NAME}} into the system prompt — and, when the model
  // echoed them, into the user's output). renderSystemPrompt also strips any
  // residual {{...}} so a placeholder token can never reach the model.
  const systemContent = systemPromptOverride
    ? systemPromptOverride
    : renderSystemPrompt(SYSTEM_PROMPT_TEMPLATE, {
        '{{BOT_NAME}}': nickname || 'Cat-Bot',
        '{{USER_NAME}}': userName || 'User',
        '{{COMMAND_PREFIX}}': ctx.prefix || '/',
        '{{USER_ROLE}}': userRoleLabel,
        '{{AVAILABLE_COMMANDS}}': availableCommandsList,
        '{{AGENT_COMMAND_LIMIT_NOTE}}': agentCommandLimitNote,
        '{{AGENT_COMMAND_LIMIT}}': String(AGENT_COMMAND_LIMIT),
      });

  // Surface attached media to the model: when the user's message carries an
  // image (or replies to one), append a short note so the agent knows it can
  // process it via image commands (the note carries metadata only, never
  // token-bearing CDN URLs).
  const mediaContext = describeUserMedia(ctx.event);
  const userContent = mediaContext
    ? `${userInput}\n\n${mediaContext}`
    : userInput;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    {
      role: 'system',
      content: systemContent,
    },
    { role: 'user', content: userContent },
  ];

  let turns = 20; // Safety limit — prevents runaway tool-call loops

  // Tracks whether send_result actually delivered a reply this turn. Bare-text
  // final answers are suppressed ONLY when this is true — otherwise a model that
  // answers conversationally without the tool workflow would be dropped entirely,
  // leaving the user with total silence.
  let delivered = false;

  while (turns-- > 0) {
    // Reasoning phase — reset to the generic "thinking" phrase before each
    // model call; it will be overwritten with a specific action below the
    // moment a tool call is actually dispatched.
    setAgentStatus(ctx, DEFAULT_AGENT_STATUS_TEXT);

    let response: Awaited<ReturnType<typeof groq.chat.completions.create>>;
    try {
      response = await groq.chat.completions.create(
        {
          model: 'openai/gpt-oss-120b',
          messages,
          tools: groqTools,
          tool_choice: 'auto',
        },
        { timeout: GROQ_REQUEST_TIMEOUT_MS },
      );
    } catch (err) {
      if (isGroqRateLimitError(err)) {
        throw new AgentRateLimitError(
          'Your Groq API key has reached its rate limit. ' +
            'AI features are temporarily paused — wait a moment and try again.',
        );
      }
      const recovered = extractFailedToolGeneration(err);
      // The recovered name is either a known alias (the Groq "json" quirk →
      // send_result) or a REAL tool name whose arguments Groq's server-side
      // validation rejected (e.g. get_user called with {"uid": null}). Resolve
      // either way so a validation failure executes the tool directly instead
      // of killing the whole agent turn.
      const recoveredName = recovered
        ? (TOOL_NAME_ALIASES[recovered.name] ?? recovered.name)
        : undefined;
      const recoveredTool = recoveredName
        ? cachedToolsMap!.get(recoveredName)
        : undefined;

      if (!recovered || !recoveredName || !recoveredTool) {
        // No tool matches the recovered name — nothing to recover, surface the
        // original error to the caller as before.
        throw err;
      }

      // Splice the recovered call back into the conversation as if Groq had
      // returned it normally, then execute it through the real tool.
      const syntheticId = `recovered_${Date.now()}_${turns}`;
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: syntheticId,
            type: 'function',
            function: { name: recoveredName, arguments: recovered.arguments },
          },
        ],
      });

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(recovered.arguments);
      } catch {
        args = {};
      }

      setAgentStatus(ctx, describeToolStatus(recoveredName, args));
      try {
        // Same per-tool timeout as the normal dispatch path below.
        const result =
          recoveredName === 'test_command'
            ? await recoveredTool.run(args, ctx)
            : await withTimeout(
                Promise.resolve(recoveredTool.run(args, ctx)),
                TOOL_TIMEOUT_MS,
                recoveredName,
              );
        if (recoveredName === 'send_result') {
          // send_result returns 'Delivery failed: …' (not a throw) on error — only
          // count genuine deliveries so a failed send followed by a text apology
          // is still surfaced to the user.
          delivered = !String(result).startsWith('Delivery failed:');
        }
        messages.push({
          role: 'tool',
          tool_call_id: syntheticId,
          content: String(result),
        });
      } catch (toolErr) {
        messages.push({
          role: 'tool',
          tool_call_id: syntheticId,
          content: `Tool execution error: ${
            toolErr instanceof Error ? toolErr.message : String(toolErr)
          }`,
        });
      }

      continue; // Proceed to the next turn with the recovered result in context.
    }

    const message = response.choices[0]?.message;
    if (!message) break;

    messages.push(message);

    // ✅ FINAL ANSWER — agent should have called send_result for delivery.
    // When the model finishes with bare text (no tool call): if send_result already
    // delivered, return '' so ai.ts's `if (result)` guard skips a duplicate reply.
    // If NOTHING was delivered, this text IS the answer — return it so ai.ts sends
    // it. Dropping it unconditionally made the bot go silent whenever the model
    // answered a simple conversational prompt without the tool workflow.
    if (!message.tool_calls || message.tool_calls.length === 0) {
      if (delivered) return '';
      // Unwrap the model's content down to the actual reply text — gpt-oss-120b
      // occasionally finishes with the Harmony "commentary/final json" envelope
      // (or a double-encoded JSON string) instead of plain text. extractHumanText
      // collapses those to the real value so the user never sees raw JSON.
      const text = extractHumanText(message.content) ?? '';
      // Safety net: the model finished with bare text while media was captured
      // this turn (test_command) but send_result was never called. Deliver the
      // text together with the media so a requested image or video is NEVER
      // answered with text only. Returns '' once delivered so ai.ts's
      // `if (result)` guard skips the duplicate text reply.
      const pending = getPendingMedia(ctx);
      if (
        text &&
        (pending.urls.length > 0 || pending.binaries.length > 0)
      ) {
        const ok = await deliverAgentMedia(ctx, text);
        clearPendingMedia(ctx);
        if (ok) return '';
      }
      return text;
    }

    // =========================
    // 🔧 TOOL EXECUTION
    // =========================
    for (const toolCall of message.tool_calls) {
      const tool = cachedToolsMap!.get(toolCall.function.name);

      if (!tool) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Error: Tool '${toolCall.function.name}' not found.`,
        });
        continue;
      }

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      // Reflect the specific action about to run in the live status text so
      // the thinking indicator shows what the agent is actually doing.
      setAgentStatus(ctx, describeToolStatus(toolCall.function.name, args));

      try {
        // Execute dynamic tool passing the requested args and the application context.
        // test_command self-limits with its own 10-minute race; every other tool is
        // capped so a hung network/DB call can never pin the agent loop.
        const result =
          toolCall.function.name === 'test_command'
            ? await tool.run(args, ctx)
            : await withTimeout(
                Promise.resolve(tool.run(args, ctx)),
                TOOL_TIMEOUT_MS,
                toolCall.function.name,
              );
        if (toolCall.function.name === 'send_result') {
          // send_result returns 'Delivery failed: …' (not a throw) on error — only
          // count genuine deliveries so a failed send followed by a text apology
          // is still surfaced to the user.
          delivered = !String(result).startsWith('Delivery failed:');
        }
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: String(result),
        });
      } catch (err) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Tool execution error: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    }
  }

  return 'I had to stop processing because the task required too many steps.';
}