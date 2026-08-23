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

/**
 * True for 400-class rejections that indicate the model/endpoint does not
 * support (native) tool calling — "tools is not supported", "function calling
 * is not enabled", "invalid type for 'tools'", etc. Lets the loops degrade to
 * a plain no-tools completion instead of failing the turn.
 */
function isToolsUnsupportedError(err: unknown): boolean {
  if (!err) return false;
  const e = err as {
    status?: number;
    statusCode?: number;
    message?: string;
    error?: { message?: string } | string;
  };
  const status = e.status ?? e.statusCode;
  if (status !== 400 && status !== 404 && status !== 422) return false;
  const detail =
    typeof e.error === 'string' ? e.error : (e.error?.message ?? '');
  const msg = `${e.message ?? ''} ${detail}`.toLowerCase();
  return /tool|function/.test(msg);
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
// Conservative (most tokenizers land near 3 chars/token; 3.5 undershoots on
// English prose and code) — overshooting small models' context windows is
// worse than trimming a little early.
const CHARS_PER_TOKEN = 3;
// Output cap per LLM request — without it a runaway model can emit thousands
// of completion tokens per tool-loop iteration (up to 6 requests per turn).
const MAX_OUTPUT_TOKENS = 2_048;
// Head+tail split for truncated tool results: leading content usually carries
// the payload, while errors/summaries land at the tail — keeping both sides
// preserves far more signal than a head-only cut for the same token budget.
const TOOL_RESULT_HEAD_CHARS = 4_000;
const TOOL_RESULT_TAIL_CHARS = 1_500;

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

/**
 * Caps a tool result before it is fed back to the LLM, keeping BOTH the head
 * and the tail (errors/summaries usually appear at the end of long output).
 */
export function capToolResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_CHARS) return result;
  const omitted = result.length - TOOL_RESULT_HEAD_CHARS - TOOL_RESULT_TAIL_CHARS;
  return (
    result.slice(0, TOOL_RESULT_HEAD_CHARS) +
    `\n…[truncated ${omitted} chars]…\n` +
    result.slice(-TOOL_RESULT_TAIL_CHARS)
  );
}

/** True when a tool call batch must run sequentially (delivery/side-effects). */
function needsSequentialTools(calls: Array<{ name: string }>): boolean {
  return calls.some(
    (c) => c.name === 'send_result' || c.name === 'run_command',
  );
}

type ExecFn = (name: string, args: Record<string, unknown>) => Promise<string>;

/** One tool call parsed out of model-emitted TEXT (not native tool_calls). */
interface ParsedTextCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Extracts {name, arguments|parameters} from a candidate JSON tool-call body,
 * accepting both the flat shape ({"name","arguments"}) and the nested shape
 * ({"function":{"name","arguments"}}) that prompt-style models emit.
 */
function coerceToolCallJson(parsed: unknown): ParsedTextCall | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, any>;
  const flat =
    typeof obj.name === 'string' && obj.name
      ? { name: obj.name, args: obj.arguments ?? obj.parameters ?? {} }
      : null;
  const nested =
    obj.function && typeof obj.function.name === 'string'
      ? {
          name: obj.function.name,
          args: obj.function.arguments ?? {},
        }
      : null;
  const call = flat ?? nested;
  if (!call) return null;
  if (typeof call.args === 'string') {
    try {
      call.args = JSON.parse(call.args);
    } catch {
      call.args = {};
    }
  }
  if (!call.args || typeof call.args !== 'object') call.args = {};
  return { name: call.name, args: call.args as Record<string, unknown> };
}

/**
 * Parses tool calls that models without native function calling emit as TEXT
 * (common behind router providers like OrcaRouter/FastRouter auto routes,
 * Qwen/DeepSeek-style). Supported shapes:
 *   • <tool_call>{"name":…, "arguments":{…}}</tool_call> (Qwen, repeatable)
 *   • <function_calls>…</function_calls> wrapping JSON call object(s)
 *   • a fenced or bare JSON object that is a single tool call
 * Returns the parsed calls and whatever prose remains outside them.
 */
export function parseTextToolCalls(
  text: string,
): { calls: ParsedTextCall[]; prose: string } {
  const calls: ParsedTextCall[] = [];
  let prose = text;

  // <tool_call>{…}</tool_call> — may appear several times in one response.
  prose = prose.replace(/<tool_call>([\s\S]*?)<\/tool_call>/gi, (_m, body: string) => {
    try {
      const call = coerceToolCallJson(JSON.parse(body));
      if (call) calls.push(call);
    } catch {
      /* unparsable body — drop it */
    }
    return '';
  });

  // <function_calls>{…}</function_calls> — some templates wrap JSON, others
  // wrap <invoke> markup; only the JSON variant is handled, the rest falls
  // through to stripping.
  prose = prose.replace(
    /<function_calls?>([\s\S]*?)<\/function_calls?>/gi,
    (_m, body: string) => {
      const jsonBody = body.match(/\{[\s\S]*\}/);
      if (jsonBody) {
        try {
          const call = coerceToolCallJson(JSON.parse(jsonBody[0]));
          if (call) {
            calls.push(call);
            return '';
          }
        } catch {
          /* not JSON — keep it out of the prose but don't crash */
          return '';
        }
      }
      return '';
    },
  );

  // Fenced JSON tool call ```json {"name": …, "arguments": …}```
  prose = prose.replace(
    /```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi,
    (_m, body: string) => {
      try {
        const call = coerceToolCallJson(JSON.parse(body));
        if (call) {
          calls.push(call);
          return '';
        }
      } catch {
        /* not a tool call — keep the fence */
        return _m;
      }
      return _m;
    },
  );

  // Whole (remaining) response is a bare JSON tool-call object.
  const trimmed = prose.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const call = coerceToolCallJson(JSON.parse(trimmed));
      if (call) {
        calls.push(call);
        prose = '';
      }
    } catch {
      /* not JSON — leave as prose */
    }
  }

  return { calls, prose: prose.trim() };
}

/**
 * Strips any text-emitted tool-call markup from a reply, returning null when
 * nothing but tool calls remain (the caller then has no text to deliver).
 */
function stripRawToolCalls(text: string): string | null {
  const { calls, prose } = parseTextToolCalls(text);
  if (calls.length > 0 && !prose) return null;
  return prose || null;
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
  let toolsDisabled = false; // set when a provider rejects tools (see below)

  for (let i = 0; i < maxToolIterations; i++) {
    let response: any;
    try {
      response = await callLlm((signal) =>
        client.chat.completions.create(
          {
            model,
            messages,
            max_tokens: MAX_OUTPUT_TOKENS,
            // exactOptionalPropertyTypes: only attach tools/tool_choice when present.
            ...(oaTools && !toolsDisabled
              ? { tools: oaTools, tool_choice: 'auto' as const }
              : {}),
          },
          // The OpenAI SDK cancels the underlying HTTP request when aborted.
          { signal },
        ),
      );
    } catch (err: any) {
      // Some models behind OpenAI-compatible gateways don't accept function
      // calling at all and 400 on the tools parameter. Retry once WITHOUT
      // tools so the model still answers instead of the turn dying.
      if (oaTools && !toolsDisabled && isToolsUnsupportedError(err)) {
        logger.warn(
          '[AgentRunner] Provider rejected tools — retrying without tools',
          { provider, model },
        );
        toolsDisabled = true;
        continue;
      }
      throw err;
    }

    const choice = response.choices?.[0];
    if (!choice) {
      logger.warn('[AgentRunner] No choices in response', {
        finish_reason: (response as any).finish_reason ?? 'unknown',
      });
      break;
    }

    const msg = choice.message;

    // Models without native function calling (common on router auto-routes)
    // emit tool calls as TEXT. Parse those shapes and run them through the
    // exact same execution path as native tool_calls, so every provider can
    // actually use tools instead of the calls being silently discarded.
    let funcCalls: any[] = (msg.tool_calls ?? []).filter(
      (tc: any) => tc.type === 'function',
    );
    if (funcCalls.length === 0 && typeof msg.content === 'string') {
      const parsed = parseTextToolCalls(msg.content);
      if (parsed.calls.length > 0) {
        funcCalls = parsed.calls.map((c, idx) => ({
          id: `textcall_${Date.now()}_${idx}`,
          type: 'function',
          function: {
            name: c.name,
            arguments: JSON.stringify(c.args),
          },
        }));
        msg.content = parsed.prose || null;
      }
    }

    messages.push(msg);

    if (funcCalls.length === 0) {
      const text = typeof msg.content === 'string' ? msg.content : null;
      return text ? stripRawToolCalls(text) : null;
    }

    let commandDispatched = false;

    // Parallel-safe batches (independent tools) run concurrently to cut turn
    // latency; delivery/side-effect tools (send_result, run_command) keep
    // strict ordering to avoid duplicate replies and single-use-key loss.
    const runOne = async (tc: any): Promise<{ tc: any; result: string }> => {
      let args: Record<string, unknown> = {};
      let malformed = false;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        malformed = true;
      }
      // Never EXECUTE a tool with silently-emptied args — the wrong command
      // could run. Bounce it back so the model re-emits valid JSON arguments.
      const result = malformed
        ? 'Error: the tool call arguments were not valid JSON. Re-send the tool call with a valid JSON "arguments" object.'
        : await execFn(tc.function.name, args);
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

// ── Gemini schema sanitization ─────────────────────────────────────────────────
// Gemini function declarations accept a SUBSET of JSON Schema: keys like
// $schema, additionalProperties, default, exclusiveMinimum as a number, etc.
// are rejected with a 400. MCP tool schemas (internal AND external) are plain
// JSON Schema, so every declaration is sanitized before it is sent.
const GEMINI_DROP_KEYS = new Set([
  '$schema',
  '$defs',
  '$id',
  '$comment',
  'title',
  'additionalProperties',
  'default',
  'examples',
  'format',
  'patternProperties',
  'dependencies',
  'dependentSchemas',
  'if',
  'then',
  'else',
  'contains',
  'propertyNames',
  'minProperties',
  'maxProperties',
]);

export function sanitizeForGemini(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeForGemini);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (GEMINI_DROP_KEYS.has(k)) continue;
    // Gemini wants exclusiveMinimum/Maximum as numbers, JSON Schema Draft-4
    // style; Draft-6 booleans are dropped (min/max already carry the bound).
    if ((k === 'exclusiveMinimum' || k === 'exclusiveMaximum') && typeof v === 'boolean') {
      continue;
    }
    out[k] = sanitizeForGemini(v);
  }
  return out;
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
    parameters: sanitizeForGemini(t.parameters),
  }));
  let toolsDisabled = false; // set when the model rejects function calling

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

  const buildRequest = () =>
    ({
      model,
      contents,
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        ...(functionDeclarations.length > 0 && !toolsDisabled
          ? { tools: [{ functionDeclarations }] }
          : {}),
      },
    }) as any;

  for (let i = 0; i < maxToolIterations; i++) {
    let response: any;
    try {
      response = await callLlm(() => client.models.generateContent(buildRequest()));
    } catch (err: any) {
      if (functionDeclarations.length > 0 && !toolsDisabled && isToolsUnsupportedError(err)) {
        logger.warn(
          '[AgentRunner] Gemini rejected tools — retrying without tools',
          { model },
        );
        toolsDisabled = true;
        continue;
      }
      throw err;
    }

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
