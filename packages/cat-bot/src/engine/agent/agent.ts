import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { AppCtx } from '@/engine/types/controller.types.js';
import { resolveAgentContext } from '@/engine/agent/agent.util.js';
import type { AgentTool } from '@/engine/agent/agent.util.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { buildCommandCatalog } from '@/engine/agent/lib/command-catalog.lib.js';
import { buildNeedleTools } from '@/engine/agent/lib/tool-schema.lib.js';
import {
  completeTurn,
  resetRemote,
  resolveNeedleConfig,
  NeedleClientError,
} from '@/engine/agent/lib/needle-client.lib.js';
import {
  createAiContext,
  destroyAiContext,
} from '@/engine/agent/lib/ai-context-store.lib.js';
import { aiRateLimiter } from '@/engine/agent/lib/rate-limit.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// ============================================================================
// PROMPT TEMPLATE
// ============================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Minimal embedded fallback so a missing prompt asset degrades to
// "AI unavailable" instead of crashing the process at import time.
const FALLBACK_PROMPT = [
  'The assistant is {{BOT_NAME}}, a chat assistant integrated into Persian-Bot.',
  'Command prefix: `{{COMMAND_PREFIX}}` User: {{USER_NAME}} ({{USER_ROLE}})',
  '<available_commands>{{AVAILABLE_COMMANDS}}</available_commands>',
  'ALWAYS call `send_result` as the final action of every turn.',
  'Workflow: `help` (discover) → `test_command` (preview) → `send_result` (deliver).',
].join('\n');

function loadSystemPromptTemplate(): string {
  try {
    return fs.readFileSync(
      path.join(__dirname, '../../../agent/system_prompt.md'),
      'utf-8',
    );
  } catch (err) {
    logger.error('[Agent] system_prompt.md missing, using fallback', {
      error: err,
    });
    return FALLBACK_PROMPT;
  }
}

// ============================================================================
// MODULAR TOOL LOADER
// ============================================================================

let cachedTools: AgentTool[] | null = null;

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
    return cachedTools;
  }

  const files = (await fs.promises.readdir(dir)).filter(
    (f) => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts'),
  );

  for (const file of files) {
    try {
      const mod = (await import(pathToFileURL(path.join(dir, file)).href)) as
        | AgentTool
        | { default?: AgentTool };
      const tool =
        (mod as AgentTool).config && typeof (mod as AgentTool).run === 'function'
          ? (mod as AgentTool)
          : (mod as { default?: AgentTool }).default;
      if (tool?.config && typeof tool.run === 'function') {
        tools.push(tool);
      }
    } catch (err) {
      logger.error(`[Agent] Failed to load tool ${file}`, { error: err });
    }
  }

  cachedTools = tools;
  return cachedTools;
}

/** Clears the tool cache (tests only). */
export function __clearToolCacheForTests(): void {
  cachedTools = null;
}

const MAX_TURNS = 20;
// Transcript growth guard: keep the system head, truncate the middle.
const MAX_TRANSCRIPT_CHARS = 12000;
const SYSTEM_HEAD_CHARS = 6000;
const MAX_TRANSCRIPT_TAIL_CHARS = 5000;

interface ToolMessage {
  tool: string;
  content: string;
}

/**
 * Runs the agent loop against the separately hosted Cactus Needle 3 service.
 *
 * Each iteration = exactly ONE Needle turn (`complete`). Returned
 * `function_calls` (help / test_command / send_result) execute LOCALLY with
 * the authenticated AppCtx; their outputs are JSON-encoded and fed back as
 * the next turn's input — the documented Needle multi-turn pattern. The
 * Needle service keeps one stateful `Needle` instance per AI session id.
 *
 * Safety:
 *   - bounded loop (20 turns max) — no runaway execution
 *   - confidence gating: tool calls below NEEDLE_CONFIDENCE_THRESHOLD are
 *     refused (unless Needle provides no confidence, in which case the call
 *     proceeds through the normal guard + dispatcher authorization)
 *   - empty function_calls = legitimate refusal → polite reply via send_result
 *     semantics (empty string return would suppress; we synthesize a refusal
 *     message through the normal path instead — see below)
 *   - rate limits enforced before the first turn
 *   - Needle outage → graceful AI-unavailable message; bot keeps running
 */
export async function runAgent(
  userInput: string,
  ctx: AppCtx,
  nickname?: string | null,
  userName?: string | null,
): Promise<string> {
  const { senderID, threadID, sessionUserId, sessionId, platform } =
    resolveAgentContext(ctx);

  // ── Rate limiting (never blocks non-AI commands) ─────────────────────
  const userKey = `${sessionUserId}:${platform}:${sessionId}:${senderID || 'anon'}`;
  const sessionKey = `${sessionUserId}:${platform}:${sessionId}`;
  const cadenceBlock = aiRateLimiter.checkCadence(userKey, sessionKey);
  if (cadenceBlock) return cadenceBlock;
  if (!aiRateLimiter.tryAcquire(sessionKey)) {
    return 'The AI is busy right now. Please try again in a moment.';
  }

  // Opaque handle binding this AI sequence to server-side coords.
  // Identity always comes from here — never from model-provided values.
  const aiCtx = createAiContext({
    userId: sessionUserId,
    platform,
    sessionId,
    threadId: threadID,
    senderId: senderID,
    messageId: (ctx.event['messageID'] as string) || '',
  });

  try {
    const cfg = await resolveNeedleConfig();
    if (!cfg.enabled) {
      return 'The AI is currently disabled.';
    }
    if (!cfg.url) {
      return 'The AI is not configured yet. An admin can connect it from the AI Agent dashboard page.';
    }
    // No Service Token required when the hosted service is unauthenticated —
    // the client only sends Authorization when a token is configured.

    const tools = await loadAgentTools();
    if (tools.length === 0) {
      logger.error('[Agent] No agent tools loaded');
      return 'The AI tools failed to load. Please try again later.';
    }

    // ── Dynamic context for the system prompt ──────────────────────────
    let userRoleLabel = 'Regular User';
    if (senderID) {
      try {
        if (await isSystemAdmin(senderID)) userRoleLabel = 'System Administrator';
        else if (
          sessionUserId &&
          sessionId &&
          (await isBotAdmin(sessionUserId, platform, sessionId, senderID))
        ) {
          userRoleLabel = 'Bot Administrator';
        } else if (threadID && (await isThreadAdmin(threadID, senderID))) {
          userRoleLabel = 'Thread Administrator';
        }
      } catch {
        // Fail-open — defaults to Regular User
      }
    }

    const { groupedList, allowedNames } = await buildCommandCatalog(ctx);
    const needleTools = buildNeedleTools(allowedNames);

    const systemContent = loadSystemPromptTemplate()
      .replace('{{BOT_NAME}}', nickname || 'Persian-Bot')
      .replace('{{USER_NAME}}', userName || 'User')
      .replace('{{COMMAND_PREFIX}}', ctx.prefix || '/')
      .replace('{{USER_ROLE}}', userRoleLabel)
      .replace('{{AVAILABLE_COMMANDS}}', groupedList);

    // ── Bounded agent loop ─────────────────────────────────────────────
    // The hosted playground exposes single-turn /complete with one shared
    // conversation slot and no per-session state, so multi-turn is driven
    // here: every query carries the full local transcript (system prompt +
    // catalogue on turn 1, tool results appended after). A /reset opens and
    // closes our sequence so we never inherit another session's context.
    await resetRemote(cfg);
    let transcript =
      `${systemContent}\n\nUser request:\n${userInput}`;
    let turns = MAX_TURNS;
    let testCommandCalls = 0;
    const history: ToolMessage[] = [];

    while (turns-- > 0) {
      let turn;
      try {
        const res = await completeTurn({
          query: transcript,
          tools: needleTools,
          config: cfg,
        });
        turn = res.turn;
      } catch (err) {
        if (err instanceof NeedleClientError) {
          logger.error('[Agent] Needle 3 turn failed', { error: err });
          if (err.code === 'UNAUTHORIZED') {
            return 'The AI service rejected authentication. An admin should check the Service Token.';
          }
          if (
            err.code === 'TIMEOUT' ||
            err.code === 'SERVICE_UNAVAILABLE' ||
            err.code === 'UNRESOLVABLE' ||
            err.code === 'REFUSED'
          ) {
            return 'The AI service is temporarily unavailable. Please try again later.';
          }
          if (
            err.code === 'MALFORMED' ||
            err.code === 'INVALID' ||
            err.code === 'NEEDLE_ERROR' ||
            err.code === 'ENDPOINT_NOT_FOUND'
          ) {
            return 'The AI service returned an unexpected response. Please try again later.';
          }
          return 'The AI is temporarily unavailable. Please try again later.';
        }
        logger.error('[Agent] Needle 3 turn failed', { error: err });
        return 'The AI is temporarily unavailable. Please try again later.';
      }

      // ── Engine-level failure ─────────────────────────────────────────
      if (!turn.success) {
        return 'The AI could not process that request. Please try rephrasing it.';
      }

      // ── Empty function_calls = legitimate refusal / unsupported ──────
      // Never invent an action: reply conversationally via the normal path.
      if (turn.functionCalls.length === 0) {
        // If send_result already delivered, tools report back through history;
        // otherwise synthesize a refusal as the turn result.
        const delivered = history.some((h) => h.tool === 'send_result');
        if (delivered) return '';
        return "I can't help with that. Try asking about one of the bot's commands.";
      }

      // ── Execute tool calls locally ───────────────────────────────────
      const feedback: string[] = [];
      for (const call of turn.functionCalls) {
        const tool = tools.find((t) => t.config.name === call.name);
        if (!tool) {
          feedback.push(
            `Tool '${call.name}' not found. Available tools: ${tools.map((t) => t.config.name).join(', ')}.`,
          );
          continue;
        }

        // Confidence gate: uncertain calls are refused, never executed.
        // No threshold applied when the model provides no confidence score.
        if (
          tool.config.name !== 'send_result' &&
          turn.confidence !== null &&
          turn.confidence < cfg.confidenceThreshold
        ) {
          feedback.push(
            `Tool '${call.name}' suppressed: confidence ${turn.confidence.toFixed(2)} ` +
              `is below the required ${cfg.confidenceThreshold.toFixed(2)}. ` +
              `Ask the user for clarification instead.`,
          );
          continue;
        }

        if (tool.config.name === 'test_command') {
          testCommandCalls += 1;
          if (testCommandCalls > aiRateLimiter.maxCommandsPerTurn) {
            feedback.push(
              'Too many command executions in one turn. Combine what you have with send_result.',
            );
            continue;
          }
        }

        try {
          const result = await tool.run(call.arguments, ctx);
          history.push({ tool: call.name, content: String(result) });
          feedback.push(`[${call.name} result]\n${String(result)}`);
          if (call.name === 'send_result') {
            // Controlled delivery complete — suppress duplicates.
            return '';
          }
        } catch (err) {
          feedback.push(
            `Tool execution error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      transcript =
        `${transcript}\n\n[tool results]\n${JSON.stringify(feedback)}\n` +
        'Continue: call test_command for remaining commands, then send_result exactly once.';
      // Bound the transcript so long sequences cannot grow without limit;
      // the system head (prompt + catalogue) is always preserved.
      if (transcript.length > MAX_TRANSCRIPT_CHARS) {
        transcript =
          transcript.slice(0, SYSTEM_HEAD_CHARS) +
          '\n\n[…earlier turns omitted…]\n' +
          transcript.slice(-MAX_TRANSCRIPT_TAIL_CHARS);
      }
    }

    return 'I had to stop processing because the task required too many steps.';
  } finally {
    destroyAiContext(aiCtx.id);
    aiRateLimiter.release(sessionKey);
    void resetRemote().catch(() => undefined);
  }
}
