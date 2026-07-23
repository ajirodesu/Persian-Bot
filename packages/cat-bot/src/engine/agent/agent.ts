import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Groq from 'groq-sdk';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { resolveAgentContext } from '@/engine/agent/agent.util.js';
import { env } from '@/engine/config/env.config.js';
import type { AgentTool } from '@/engine/agent/agent.util.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';

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
// GROQ CLIENT SINGLETON
// ============================================================================
// Creating a new Groq instance on every runAgent call is wasteful — the
// client is stateless (just holds the API key and base URL) and safe to
// reuse across calls.  Lazy-initialise once and reuse for the process lifetime.
/** Maximum bot commands a non-system-admin user may request per agent invocation. */
export const AGENT_COMMAND_LIMIT = 5;

let _groqInstance: Groq | null = null;
function getGroq(): Groq {
  if (!_groqInstance) {
    const key = env.GROQ_API_KEY;
    if (!key) {
      throw new Error(
        'GROQ_API_KEY environment variable is not set. AI capabilities are disabled.',
      );
    }
    _groqInstance = new Groq({ apiKey: key });
  }
  return _groqInstance;
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
      console.error(`[Agent] Failed to load tool ${file}`, err);
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
 */
export async function runAgent(
  userInput: string,
  ctx: AppCtx,
  nickname?: string | null,
  userName?: string | null,
  systemPromptOverride?: string | null,
): Promise<string> {
  const groq = getGroq();

  // loadAgentTools() is idempotent and returns the cached list after the first call.
  // cachedGroqTools and cachedToolsMap are populated in the same call — safe to use directly.
  await loadAgentTools();
  const groqTools = cachedGroqTools!;

  // Inject dynamic context variables into the structured system prompt template.
  const { senderID, threadID, sessionUserId, sessionId, platform } =
    resolveAgentContext(ctx);
  let userRoleLabel = 'Regular User';
  if (senderID && sessionUserId && sessionId) {
    try {
      const isAdmin = await isBotAdmin(
        sessionUserId,
        platform,
        sessionId,
        senderID,
      );
      if (isAdmin) {
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
  // System admins are unconditionally exempt — no budget is attached for them.
  // Fail-open: if the system-admin check throws, treat as non-admin (budget applies).
  let _isSysAdmin = false;
  if (senderID) {
    try {
      _isSysAdmin = await isSystemAdmin(senderID);
    } catch {
      // Fail-open — apply limit on DB error
    }
  }
  if (!_isSysAdmin) {
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

  const systemContent = systemPromptOverride
    ? systemPromptOverride
    : SYSTEM_PROMPT_TEMPLATE.replace(
        '{{BOT_NAME}}',
        nickname || 'Cat-Bot',
      )
        .replace('{{USER_NAME}}', userName || 'User')
        .replace('{{COMMAND_PREFIX}}', ctx.prefix || '/')
        .replace('{{USER_ROLE}}', userRoleLabel)
        .replace('{{AVAILABLE_COMMANDS}}', availableCommandsList);

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
    const response = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages,
      tools: groqTools,
      tool_choice: 'auto',
    });

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