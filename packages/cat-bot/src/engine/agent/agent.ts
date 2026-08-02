import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Groq from 'groq-sdk';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { resolveAgentContext } from '@/engine/agent/agent.util.js';
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

  // loadAgentTools() is idempotent and returns the cached list after the first call.
  // cachedGroqTools and cachedToolsMap are populated in the same call — safe to use directly.
  await loadAgentTools();
  const groqTools = cachedGroqTools!;

  // Inject dynamic context variables into the structured system prompt template.
  let userRoleLabel = 'Regular User';
  // Hoisted out of the try block below (not just a local) — reused by the
  // agent command limit exemption further down, since "Bot Administrator"
  // (the owner/admin of this specific bot session) is also meant to bypass
  // the per-message command cap, not only a global System Admin.
  let _isBotAdmin = false;
  if (senderID && sessionUserId && sessionId) {
    try {
      _isBotAdmin = await isBotAdmin(
        sessionUserId,
        platform,
        sessionId,
        senderID,
      );
      if (_isBotAdmin) {
        userRoleLabel = 'Bot Administrator';
      } else if (threadID) {
        const isThreadAdm = await isThreadAdmin(threadID, senderID);
        if (isThreadAdm) userRoleLabel = 'Thread Administrator';
      }
    } catch {
      // Fail-open — a temporary DB outage defaults to Regular User
    }
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
  let _isSysAdmin = false;
  if (senderID) {
    try {
      _isSysAdmin = await isSystemAdmin(senderID);
    } catch {
      // Fail-open — apply limit on DB error
    }
  }
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

  const systemContent = systemPromptOverride
    ? systemPromptOverride
    : SYSTEM_PROMPT_TEMPLATE.replace(
        '{{BOT_NAME}}',
        nickname || 'Cat-Bot',
      )
        .replace('{{USER_NAME}}', userName || 'User')
        .replace('{{COMMAND_PREFIX}}', ctx.prefix || '/')
        .replace('{{USER_ROLE}}', userRoleLabel)
        .replace('{{AVAILABLE_COMMANDS}}', availableCommandsList)
        .replace('{{AGENT_COMMAND_LIMIT_NOTE}}', agentCommandLimitNote)
        .replaceAll('{{AGENT_COMMAND_LIMIT}}', String(AGENT_COMMAND_LIMIT));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    {
      role: 'system',
      content: systemContent,
    },
    { role: 'user', content: userInput },
  ];

  let turns = 20; // Safety limit — prevents runaway tool-call loops

  while (turns-- > 0) {
    // Reasoning phase — reset to the generic "thinking" phrase before each
    // model call; it will be overwritten with a specific action below the
    // moment a tool call is actually dispatched.
    setAgentStatus(ctx, DEFAULT_AGENT_STATUS_TEXT);

    let response: Awaited<ReturnType<typeof groq.chat.completions.create>>;
    try {
      response = await groq.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages,
        tools: groqTools,
        tool_choice: 'auto',
      });
    } catch (err) {
      const recovered = extractFailedToolGeneration(err);
      const aliasedName = recovered ? TOOL_NAME_ALIASES[recovered.name] : undefined;
      const aliasedTool = aliasedName ? cachedToolsMap!.get(aliasedName) : undefined;

      if (!recovered || !aliasedName || !aliasedTool) {
        // Not the known "json" quirk (or no alias/tool matches) — nothing to
        // recover, surface the original error to the caller as before.
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
            function: { name: aliasedName, arguments: recovered.arguments },
          },
        ],
      });

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(recovered.arguments);
      } catch {
        args = {};
      }

      setAgentStatus(ctx, describeToolStatus(aliasedName, args));
      try {
        const result = await aliasedTool.run(args, ctx);
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
    // Bare text responses (no tool call) are suppressed: send_result already sent the message,
    // and returning text here would cause ai.ts to re-send it as a duplicate.
    // Return '' so ai.ts's `if (result)` guard skips the redundant replyMessage call.
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return ''; // Delivery handled by send_result — suppress to prevent duplicate messages
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
        // Execute dynamic tool passing the requested args and the application context
        const result = await tool.run(args, ctx);
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