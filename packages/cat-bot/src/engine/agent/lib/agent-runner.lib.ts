/* eslint-disable @typescript-eslint/no-explicit-any --
 * Provider responses (OpenAI-compatible chat completions, Gemini parts) are
 * deliberately loosely typed — each provider returns structurally different
 * objects and the union types from the SDKs don't cover every field the loop
 * must read (e.g. finish_reason). Faithful to the canis original this file
 * ports.
 */

/**
 * AI Agent — Runner
 *
 * Port of canis src/components/ai/agentRunner.ts. Runs one agent turn: the LLM
 * may call tools, the results are fed back, and the loop continues up to the
 * user's max tool iterations (default 5). Supports every provider via two loop
 * flavours:
 *
 *   • OpenAI-compatible chat completions (openrouter / groq / nvidia / openai)
 *   • Gemini (functionDeclarations)
 *
 * Unlike canis (single global AI_PROVIDER), the provider/apiKey/model come from
 * the resolved per-user config so each bot user's dashboard settings apply.
 */

import { logger } from '@/engine/modules/logger/logger.lib.js';
import {
  type AgentProviderId,
  getOpenAiLikeClient,
  getGeminiClient,
} from './agent-providers.lib.js';
import type { ThreadMessage } from './agent-thread.lib.js';
import type { McpToolSet } from './mcp-tools.lib.js';
import type { ToolContext } from '../agent-tool.types.js';

export interface ToolLogEntry {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export interface AgentResult {
  text: string | null;
  commandToExecute: string | null;
  toolLog: ToolLogEntry[];
}

export interface ImageData {
  data: string; // base64, no prefix
  mimetype: string;
}

export interface AgentTurnConfig {
  systemPrompt: string;
  history: ThreadMessage[];
  userQuery: string;
  /** The MCP-exposed tool set: LLM-facing schemas + a callTool executor. */
  tools: McpToolSet;
  context: ToolContext;
  provider: AgentProviderId;
  apiKey?: string | undefined;
  model: string;
  imageData?: ImageData | undefined;
  /** Max tool-call iterations (defaults to 5 when unset). */
  maxToolIterations?: number;
  /** Throw an AgentRateLimitError on a 429 instead of returning the apology
   * message — used by the auto-failover wrapper (agent-handler) so it can retry
   * the turn on another provider. */
  rethrowRateLimit?: boolean;
}

/**
 * Thrown when a provider returns a rate-limit (429) error and the caller asked
 * to rethrow it (see AgentTurnConfig.rethrowRateLimit) instead of the default
 * apology message. Carries the provider + optional retry hint for logging.
 */
export class AgentRateLimitError extends Error {
  constructor(
    public readonly provider: AgentProviderId,
    public readonly hint?: string,
  ) {
    super(`Rate limited by ${provider}`);
    this.name = 'AgentRateLimitError';
  }
}

// Sentinel returned to the LLM when run_command is intercepted.
const RUN_CMD_SENTINEL = '__RUN_COMMAND_DISPATCHED__';

// ── LLM call reliability: timeout + retry ─────────────────────────────────────
// A hung or flaky provider request must never block a turn forever. Every LLM
// call is bounded by a hard timeout and retried with exponential backoff +
// jitter on transient failures (429/5xx/network), so heavy usage and provider
// hiccups degrade gracefully instead of producing apologies or hanging chats.
const LLM_TIMEOUT_MS = 90_000; // hard cap on one provider request
const LLM_MAX_RETRIES = 2; // transient failures get at most 2 backoff retries
const LLM_RETRY_BASE_MS = 500;
const LLM_RETRY_MAX_MS = 4_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True for errors worth a retry: rate limits, 5xx, and network resets. */
function isRetryableError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { status?: number; statusCode?: number; code?: unknown };
  const status = e.status ?? e.statusCode;
  if (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return true;
  }
  const code = typeof e.code === 'string' ? e.code : '';
  return /ECONNRESET|ETIMEDOUT|ECONNABORTED|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR_CONNECT_TIMEOUT/i.test(
    code,
  );
}

/** Bounds fn with a hard timeout; aborts the underlying request when possible. */
async function withTimeout<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`LLM request timed out after ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Calls one LLM request with timeout + bounded backoff retry. Retrying is safe
 * because each attempt is stateless — the caller's message list is only mutated
 * with a SUCCESSFUL response, never here.
 */
async function callLlm<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await withTimeout(fn, LLM_TIMEOUT_MS);
    } catch (err) {
      attempt += 1;
      if (attempt > LLM_MAX_RETRIES || !isRetryableError(err)) throw err;
      const base = LLM_RETRY_BASE_MS * 2 ** (attempt - 1);
      const jitter = Math.random() * LLM_RETRY_BASE_MS;
      await delay(Math.min(base + jitter, LLM_RETRY_MAX_MS));
    }
  }
}

// ── Token-budget context control ──────────────────────────────────────────────
// The conversation history is trimmed by ESTIMATED TOKENS (not just message
// count) so long-winded histories never blow past a provider's context window
// or burn tokens on stale turns. Tool results are also capped when fed back to
// the LLM — the handler keeps full test_command results in the turn's tool log,
// so capping the message copy never loses media/attachment keys.
const HISTORY_TOKEN_BUDGET = 24_000; // oldest history dropped to stay under budget
const MAX_TOOL_RESULT_CHARS = 6_000; // per tool result fed back to the LLM
const CHARS_PER_TOKEN = 3.5;

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Drops the OLDEST messages until the estimated token total fits the budget. */
function trimHistoryToBudget<T extends ThreadMessage>(
  history: T[],
  budget: number,
): T[] {
  let total = 0;
  const kept: T[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = estimateTokens(history[i]!.content);
    // Always keep the most recent message even if oversized (never empty input).
    if (kept.length > 0 && total + cost > budget) break;
    kept.unshift(history[i]!);
    total += cost;
  }
  return kept;
}

/** Caps a tool result before it is fed back to the LLM. */
function capToolResult(result: string): string {
  return result.length > MAX_TOOL_RESULT_CHARS
    ? `${result.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated]`
    : result;
}

/** True when a tool call batch must run sequentially (delivery/side-effects). */
function needsSequentialTools(calls: Array<{ name: string }>): boolean {
  return calls.some(
    (c) => c.name === 'send_result' || c.name === 'run_command',
  );
}

type ExecFn = (name: string, args: Record<string, unknown>) => Promise<string>;

function stripRawToolCalls(text: string): string | null {
  const cleaned = text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<function_calls?>[\s\S]*?<\/function_calls?>/gi, '')
    .replace(
      /```(?:json)?\s*\{[\s\S]*?"(?:name|function)"[\s\S]*?\}\s*```/gi,
      '',
    )
    .trim();

  if (!cleaned) return null;

  // Whole response is a bare JSON tool call object.
  try {
    const parsed = JSON.parse(cleaned);
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.name &&
      (parsed.arguments !== undefined || parsed.parameters !== undefined)
    ) {
      return null;
    }
  } catch {
    // Not JSON — fall through and return the cleaned text.
  }

  return cleaned;
}

async function runOpenAILike(
  provider: AgentProviderId,
  apiKey: string | undefined,
  model: string,
  systemPrompt: string,
  history: ThreadMessage[],
  userQuery: string,
  tools: McpToolSet,
  execFn: ExecFn,
  context: ToolContext,
  imageData: ImageData | undefined,
  maxToolIterations: number,
): Promise<string | null> {
  const client = getOpenAiLikeClient(provider, apiKey);

  const userContent: any = imageData
    ? [
        { type: 'text', text: userQuery },
        {
          type: 'image_url',
          image_url: {
            url: `data:${imageData.mimetype};base64,${imageData.data}`,
          },
        },
      ]
    : userQuery;

  const trimmedHistory = trimHistoryToBudget(history, HISTORY_TOKEN_BUDGET);

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userContent },
  ];

  const oaTools =
    tools.schemas.length > 0
      ? tools.schemas.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }))
      : undefined;

  const startIdx = messages.length; // first index added this turn

  for (let i = 0; i < maxToolIterations; i++) {
    const response = await callLlm((signal) =>
      client.chat.completions.create(
        {
          model,
          messages,
          // exactOptionalPropertyTypes: only attach tools/tool_choice when present.
          ...(oaTools ? { tools: oaTools, tool_choice: 'auto' as const } : {}),
        },
        // The OpenAI SDK cancels the underlying HTTP request when aborted.
        { signal },
      ),
    );

    const choice = response.choices?.[0];
    if (!choice) {
      logger.warn('[AgentRunner] No choices in response', {
        finish_reason: (response as any).finish_reason ?? 'unknown',
      });
      break;
    }

    const msg = choice.message;
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      const text = typeof msg.content === 'string' ? msg.content : null;
      return text ? stripRawToolCalls(text) : null;
    }

    const funcCalls = msg.tool_calls.filter(
      (tc: any) => tc.type === 'function',
    );
    let commandDispatched = false;

    // Parallel-safe batches (independent tools) run concurrently to cut turn
    // latency; delivery/side-effect tools (send_result, run_command) keep
    // strict ordering to avoid duplicate replies and single-use-key loss.
    const runOne = async (tc: any): Promise<{ tc: any; result: string }> => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        // Malformed arguments — execute with an empty args object.
      }
      const result = await execFn(tc.function.name, args);
      logger.debug(
        '[AgentTool]',
        `${tc.function.name} → ${result.slice(0, 80)}`,
      );
      return { tc, result };
    };

    if (needsSequentialTools(funcCalls.map((tc: any) => tc.function))) {
      for (const tc of funcCalls) {
        const { result } = await runOne(tc);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: capToolResult(result),
        });
        if (result === RUN_CMD_SENTINEL) commandDispatched = true;
      }
    } else {
      const results = await Promise.all(funcCalls.map(runOne));
      for (const { tc, result } of results) {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: capToolResult(result),
        });
        if (result === RUN_CMD_SENTINEL) commandDispatched = true;
      }
    }

    // The send_result tool already delivered the final reply to the chat (it
    // sets context.agentReplyDelivered on success). This check MUST come before
    // the commandDispatched return: when a batch mixes run_command with a
    // successful send_result, the delivered message is the reply — re-running
    // the command afterwards would post a second response.
    if (context.agentReplyDelivered) {
      return context.agentReplyDelivered.message ?? null;
    }

    if (commandDispatched) return null;
  }

  // Only scan messages added in this turn — never return stale history.
  for (let i = messages.length - 1; i >= startIdx; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && typeof m.content === 'string' && m.content) {
      return stripRawToolCalls(m.content);
    }
  }
  return null;
}

async function runGemini(
  apiKey: string | undefined,
  model: string,
  systemPrompt: string,
  history: ThreadMessage[],
  userQuery: string,
  tools: McpToolSet,
  execFn: ExecFn,
  context: ToolContext,
  imageData: ImageData | undefined,
  maxToolIterations: number,
): Promise<string | null> {
  const client = getGeminiClient(apiKey);
  const functionDeclarations = tools.schemas.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  const userParts: any[] = [{ text: userQuery }];
  if (imageData) {
    userParts.push({
      inlineData: { mimeType: imageData.mimetype, data: imageData.data },
    });
  }

  const trimmedHistory = trimHistoryToBudget(history, HISTORY_TOKEN_BUDGET);

  const contents: any[] = [
    ...trimmedHistory.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: userParts },
  ];

  for (let i = 0; i < maxToolIterations; i++) {
    const response = await callLlm(() =>
      client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: systemPrompt,
          ...(functionDeclarations.length > 0
            ? ({ tools: [{ functionDeclarations }] } as any)
            : {}),
        } as any,
      }),
    );

    const parts: any[] = response.candidates?.[0]?.content?.parts ?? [];
    const textPart = parts.find((p: any) => typeof p.text === 'string');
    const callParts = parts.filter((p: any) => p.functionCall);

    if (callParts.length === 0) {
      return textPart?.text ?? null;
    }

    contents.push({ role: 'model', parts });

    let commandDispatched = false;
    const responseParts: any[] = [];

    const runOne = async (part: any): Promise<{ part: any; result: string }> => {
      const fc = part.functionCall;
      const result = await execFn(
        fc.name,
        (fc.args ?? {}) as Record<string, unknown>,
      );
      logger.debug('[AgentTool]', `${fc.name} → ${result.slice(0, 80)}`);
      return { part, result };
    };

    if (needsSequentialTools(callParts.map((p: any) => p.functionCall))) {
      for (const part of callParts) {
        const { result } = await runOne(part);
        responseParts.push({
          functionResponse: {
            name: part.functionCall.name,
            response: { result: capToolResult(result) },
          },
        });
        if (result === RUN_CMD_SENTINEL) commandDispatched = true;
      }
    } else {
      const results = await Promise.all(callParts.map(runOne));
      for (const { part, result } of results) {
        responseParts.push({
          functionResponse: {
            name: part.functionCall.name,
            response: { result: capToolResult(result) },
          },
        });
        if (result === RUN_CMD_SENTINEL) commandDispatched = true;
      }
    }
    contents.push({ role: 'user', parts: responseParts });

    // Same early-exit as the OpenAI loop — and checked before commandDispatched
    // for the same reason: a successful send_result delivery already answered
    // the turn, so a run_command in the same batch must not post a second reply.
    if (context.agentReplyDelivered) {
      return context.agentReplyDelivered.message ?? null;
    }

    if (commandDispatched) return null;
  }

  const lastModel = [...contents]
    .reverse()
    .find((c: any) => c.role === 'model');
  const lastText = lastModel?.parts?.find(
    (p: any) => typeof p.text === 'string',
  );
  return lastText?.text ?? null;
}

/** Runs one agent turn with the given (already resolved) provider config. */
export async function runAgentTurn(cfg: AgentTurnConfig): Promise<AgentResult> {
  let commandToExecute: string | null = null;
  const toolLog: ToolLogEntry[] = [];
  let firstTool = true;
  const execFn: ExecFn = async (name, args) => {
    const isFirst = firstTool;
    firstTool = false;

    try {
      await cfg.context.onToolCall?.(name, isFirst);
    } catch {
      // Tool status notifications are best-effort — never fail the turn.
    }

    if (name === 'run_command') {
      commandToExecute = String(args.command ?? '').trim();
      toolLog.push({ name, args, result: 'dispatched' });
      return RUN_CMD_SENTINEL;
    }

    // Execution goes through the MCP client — the tool's initialize runs
    // inside the in-process MCP server, bound to this turn's ToolContext.
    const result = await cfg.tools.callTool(name, args);
    // test_command results carry the `attachment_key` / `binary_attachment_key` /
    // `button_key` values the handler's media fallback parses — keep those in
    // full. Every other tool result stays truncated for the thread summary.
    toolLog.push({
      name,
      args,
      result: name === 'test_command' ? result : result.slice(0, 400),
    });
    return result;
  };

  const emptyResult = (text: string | null): AgentResult => ({
    text,
    commandToExecute,
    toolLog,
  });

  const maxToolIterations = cfg.maxToolIterations ?? 5;

  try {
    let text: string | null = null;
    switch (cfg.provider) {
      case 'openrouter':
      case 'groq':
      case 'nvidia':
      case 'openai':
      case 'zen':
      case 'orcarouter':
      case 'fastrouter':
        text = await runOpenAILike(
          cfg.provider,
          cfg.apiKey,
          cfg.model,
          cfg.systemPrompt,
          cfg.history,
          cfg.userQuery,
          cfg.tools,
          execFn,
          cfg.context,
          cfg.imageData,
          maxToolIterations,
        );
        break;
      case 'gemini':
        text = await runGemini(
          cfg.apiKey,
          cfg.model,
          cfg.systemPrompt,
          cfg.history,
          cfg.userQuery,
          cfg.tools,
          execFn,
          cfg.context,
          cfg.imageData,
          maxToolIterations,
        );
        break;
      default:
        throw new Error(`Unsupported AI provider: ${cfg.provider}`);
    }

    return emptyResult(text);
  } catch (err: any) {
    const status: number | undefined = err?.status ?? err?.statusCode;

    if (status === 429) {
      const reset: string | undefined =
        err?.headers?.['x-ratelimit-reset-tokens'] ??
        err?.headers?.['x-ratelimit-reset-requests'];
      const hint = reset
        ? ` Try again in ${reset}.`
        : ' Please try again shortly.';
      logger.warn(`[AgentRunner] Rate limited by ${cfg.provider}${hint}`);
      if (cfg.rethrowRateLimit) {
        throw new AgentRateLimitError(
          cfg.provider,
          hint.trim() || undefined,
        );
      }
      return emptyResult(`I'm being rate-limited right now.${hint}`);
    }

    if (status === 400 && err?.error?.error?.code === 'tool_use_failed') {
      logger.warn('[AgentRunner] Tool use failed', {
        message: err.error.error.message,
      });
      return emptyResult(
        'Sorry, I ran into a problem processing that request. Please try again.',
      );
    }

    logger.error('[AgentRunner]', err);
    return emptyResult(null);
  }
}
