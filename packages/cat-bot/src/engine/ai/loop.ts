/**
 * The agent loop: think → act → observe → repeat.
 *
 * A genuine loop, not a regex: the model calls a tool, sees the result, and
 * decides what to do next — chaining calls, recovering from failures, and
 * stopping when it has enough. Offers both native function calling and a
 * `TOOL: {...}` text protocol for models that ignore tool definitions.
 *
 * Every exit is bounded: step count, wall clock, repeated identical calls,
 * unknown-tool detection, and a tool-error budget. On failure the loop takes
 * one plain no-tools pass rather than returning nothing.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

import { askAgentRaw, askAgentMessages } from './runner.js';
import { executeTool, toolDefinitions, resolveTool, resolveToolIn } from './tools.js';
import { parseToolCalls } from './tool-parse.js';
import { extractJSON } from './sanitize.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { MAX_TURN_ATTACHMENTS } from './tools.js';
import type { Tool, ToolContext, ToolAttachment } from './tools.js';
import type { AgentConfig } from './agent-types.js';
import type { ChatMessage, ToolCall } from './provider/types.js';

export type StopReason =
  | 'done'
  | 'max_steps'
  | 'timeout'
  | 'tool_error_budget'
  | 'looping'
  | 'degraded'
  | 'error';

export interface StepEvent {
  step: number;
  kind: 'thinking' | 'tool' | 'answer';
  tool?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  summary?: string;
}

export interface LoopOptions {
  /** Agent config name — routing/model/temperature come from AI config. */
  agent?: string;
  system: string;
  /** Conversation so far. The system message is supplied separately. */
  messages: ChatMessage[];
  tools?: Tool[];
  ctx: ToolContext;
  maxSteps?: number;
  timeoutMs?: number;
  maxToolErrors?: number;
  /** Tool calls honoured per assistant turn; extras are refused. */
  maxCallsPerStep?: number;
  onStep?: (ev: StepEvent) => void | Promise<void>;
  overrides?: Partial<AgentConfig>;
  /**
   * On failure, take one plain no-tools pass rather than returning nothing.
   * Default true — the difference between a weak model answering and the
   * user seeing an error.
   */
  fallbackPlain?: boolean;
  plainOverrides?: Partial<AgentConfig>;
}

export interface ToolTrace {
  step: number;
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  content: string;
  ms: number;
}

export interface LoopResult {
  text: string;
  steps: number;
  stopReason: StopReason;
  toolCalls: ToolTrace[];
  /** Full transcript, system message excluded. */
  messages: ChatMessage[];
  /** File references collected from tool results — the caller delivers them. */
  attachments: ToolAttachment[];
  /** True when a tool already delivered the reply (e.g. send_result). */
  delivered: boolean;
  error?: string | undefined;
  model?: string | undefined;
}

export const LOOP_DEFAULTS = {
  maxSteps: 6,
  timeoutMs: 90_000,
  maxToolErrors: 3,
  maxCallsPerStep: 3,
};

export function protocolPrompt(tools: Tool[]): string {
  if (!tools.length) return '';
  const list = tools
    .map((t) => {
      const props = t.parameters.properties ?? {};
      const sig = Object.entries(props)
        .map(([k, v]) => `${k}: ${v.type}${t.parameters.required?.includes(k) ? '' : '?'}`)
        .join(', ');
      return `- ${t.name}(${sig}) — ${t.description}`;
    })
    .join('\n');

  return [
    '## Tools',
    list,
    '',
    'If your provider supports function calling, call the tool normally.',
    'Otherwise reply with ONE line and nothing else:',
    'TOOL: {"name": "<tool>", "arguments": { ... }}',
    '',
    'You will then be given the result and can continue. When you have what you',
    'need, reply to the user normally — never show them the TOOL line.',
  ].join('\n');
}

interface ParsedCall {
  name: string;
  args: Record<string, unknown>;
}

function parseCallArguments(call: ToolCall): Record<string, unknown> {
  const raw = call.function?.arguments;
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return extractJSON<Record<string, unknown>>(raw) ?? {};
}

export async function runLoop(opts: LoopOptions): Promise<LoopResult> {
  const agent = opts.agent ?? 'default';
  const tools = opts.tools ?? [];
  const maxSteps = opts.maxSteps ?? LOOP_DEFAULTS.maxSteps;
  const timeoutMs = opts.timeoutMs ?? LOOP_DEFAULTS.timeoutMs;
  const maxToolErrors = opts.maxToolErrors ?? LOOP_DEFAULTS.maxToolErrors;
  const maxCallsPerStep = opts.maxCallsPerStep ?? LOOP_DEFAULTS.maxCallsPerStep;

  const deadline = Date.now() + timeoutMs;
  const defs = tools.length > 0 ? toolDefinitions(tools) : undefined;

  const system = tools.length > 0 ? `${opts.system}\n\n${protocolPrompt(tools)}` : opts.system;

  const transcript: ChatMessage[] = [...opts.messages];
  const traces: ToolTrace[] = [];
  const signatures = new Map<string, number>();
  const toolNames = tools.map((t) => t.name);
  const collectedAttachments: ToolAttachment[] = [];

  let toolErrors = 0;
  let delivered = false;
  let unknownTools = 0;
  let toolsEnabled = tools.length > 0;
  let model: string | undefined;

  const emit = async (ev: StepEvent): Promise<void> => {
    try {
      await opts.onStep?.(ev);
    } catch {
      /* UI only */
    }
  };

  for (let step = 1; step <= maxSteps; step++) {
    if (Date.now() > deadline) {
      return finish('timeout', 'I ran out of time on that one.');
    }

    await emit({ step, kind: 'thinking' });

    let reply;
    try {
      reply = await askAgentRaw(
        agent,
        [{ role: 'system', content: toolsEnabled ? system : opts.system }, ...transcript],
        opts.overrides ?? {},
        toolsEnabled ? defs : undefined,
        undefined,
        opts.ctx.userId,
      );
    } catch (err) {
      logger.warn(
        `[loop] all candidates failed (${(err as Error)?.message?.slice(0, 120)}) — trying a plain pass`,
      );
      const degraded = await plainFallback('error');
      if (degraded.text) return degraded;

      const failed: LoopResult = {
        text: '',
        steps: step - 1,
        stopReason: 'error',
        toolCalls: traces,
        messages: transcript,
        attachments: [...collectedAttachments],
        delivered,
        error: (err as Error)?.message ?? String(err),
      };
      if (model) failed.model = model;
      return failed;
    }

    model = `${reply.provider}/${reply.model}`;
    const message = reply.data;
    const text = message.content ?? '';

    let calls: ParsedCall[] = [];
    let native = false;
    let answerText = text;

    if (message.tool_calls?.length) {
      native = true;
      calls = message.tool_calls.map((c) => ({
        name: c.function.name,
        args: parseCallArguments(c),
      }));
    } else if (toolsEnabled) {
      const parsed = parseToolCalls(text, toolNames);
      calls = parsed.calls;
      answerText = parsed.cleaned;
      if (parsed.via) {
        logger.info(`[loop] tool call parsed via "${parsed.via}" (no native tool_calls)`);
      }
    }

    if (calls.length === 0) {
      const answer = answerText.trim();
      if (!answer) {
        return plainFallback('empty');
      }
      transcript.push({ role: 'assistant', content: answer });
      await emit({ step, kind: 'answer', summary: answer.slice(0, 80) });
      const done: LoopResult = {
        text: answer,
        steps: step,
        stopReason: 'done',
        toolCalls: traces,
        messages: transcript,
        attachments: [...collectedAttachments],
        delivered,
      };
      if (model) done.model = model;
      return done;
    }

    if (calls.length > maxCallsPerStep) calls = calls.slice(0, maxCallsPerStep);

    // Record the assistant turn exactly as the provider produced it, so the
    // next request is a valid continuation for native tool calling.
    if (native && message.tool_calls?.length) {
      transcript.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls });
    } else {
      transcript.push({ role: 'assistant', content: text });
    }

    // A model naming tools that do not exist will not find them next try
    // either. Drop tools and let it answer in plain text. Turn-scoped tools
    // (user MCP/Skills) count as known here.
    for (const call of calls) {
      if (!resolveToolIn(tools, call.name) && !resolveTool(call.name)) unknownTools++;
    }
    if (unknownTools >= 2 && toolsEnabled) {
      logger.warn('[loop] model kept calling tools that do not exist — continuing without tools');
      toolsEnabled = false;
    }

    // Execute sequentially: tool calls have side effects in a live chat.
    for (let ci = 0; ci < calls.length; ci++) {
      const call = calls[ci]!;
      const signature = `${call.name}:${JSON.stringify(call.args)}`;
      const seen = (signatures.get(signature) ?? 0) + 1;
      signatures.set(signature, seen);

      let result;
      if (seen > 2) {
        return finish(
          'looping',
          'I kept trying the same thing without getting anywhere. Could you rephrase?',
        );
      } else if (seen === 2) {
        result = {
          ok: false,
          content:
            `You already called ${call.name} with exactly these arguments and got a result above. ` +
            `Do not repeat it — either use what you have, try different arguments, or answer the user.`,
        };
      } else {
        const started = Date.now();
        result = await executeTool(call.name, call.args, opts.ctx, tools);
        traces.push({
          step,
          name: call.name,
          args: call.args,
          ok: result.ok,
          content: result.content,
          ms: Date.now() - started,
        });
        // Successful tools may attach files for the chat (e.g. a skill that
        // generated an image). Only http(s) URLs, deduplicated, capped.
        if (result.ok) collectAttachments(collectedAttachments, result.attachments);
        // send_result already delivered the reply — the caller must not repeat it.
        if (result.ok && (result.data as { delivered?: boolean } | undefined)?.delivered === true) {
          delivered = true;
        }
      }

      if (!result.ok) toolErrors++;
      await emit({
        step,
        kind: 'tool',
        tool: call.name,
        args: call.args,
        ok: result.ok,
        summary: result.content.slice(0, 80),
      });

      const observation = result.ok ? result.content : `Error: ${result.content}`;

      if (native) {
        const id = message.tool_calls?.[ci]?.id ?? `call_${step}_${ci}`;
        transcript.push({ role: 'tool', tool_call_id: id, name: call.name, content: observation });
      } else {
        transcript.push({
          role: 'user',
          content: `[tool result — ${call.name}]\n${observation}`,
        });
      }
    }

    if (toolErrors >= maxToolErrors) {
      return finish(
        'tool_error_budget',
        'I hit too many errors trying to do that. Something is wrong on my side.',
      );
    }
  }

  return finish(
    'max_steps',
    'That turned out to need more steps than I allow myself. Could you narrow it down?',
  );

  function lastAssistantText(): string {
    const raw = [...transcript]
      .reverse()
      .find((m) => m.role === 'assistant' && m.content && !m.tool_calls)?.content;
    if (!raw) return '';
    return parseToolCalls(raw, toolNames).cleaned.trim();
  }

  async function finish(reason: StopReason, canned: string): Promise<LoopResult> {
    const said = lastAssistantText();
    if (said) return result(said, reason);
    const degraded = await plainFallback(reason);
    if (degraded.text) return degraded;
    return { ...degraded, text: canned };
  }

  async function plainFallback(reason: StopReason | 'empty'): Promise<LoopResult> {
    if (opts.fallbackPlain === false) {
      return result('', reason === 'empty' ? 'error' : reason);
    }

    logger.warn(`[loop] degrading to a plain answer (${reason})`);

    const conversation = transcript.filter(
      (m) =>
        (m.role === 'user' && !String(m.content ?? '').startsWith('[tool result')) ||
        (m.role === 'assistant' && m.content && !m.tool_calls),
    );

    try {
      const res = await askAgentMessages(
        agent,
        [
          {
            role: 'system',
            content: `${opts.system}\n\nAnswer directly, in your own words. You have no tools available for this reply.`,
          },
          ...(conversation.length > 0 ? conversation : opts.messages),
        ],
        { ...(opts.overrides ?? {}), ...(opts.plainOverrides ?? {}) },
        opts.ctx.userId,
      );

      model = `${res.provider}/${res.model}`;
      const answer = parseToolCalls(res.data, toolNames).cleaned.trim();
      if (answer) {
        transcript.push({ role: 'assistant', content: answer });
        return result(answer, 'degraded');
      }
    } catch (err) {
      const failed: LoopResult = {
        text: '',
        steps: traces.length > 0 ? traces[traces.length - 1]!.step : 0,
        stopReason: 'error',
        toolCalls: traces,
        messages: transcript,
        attachments: [...collectedAttachments],
        delivered,
        error: (err as Error)?.message ?? String(err),
      };
      if (model) failed.model = model;
      return failed;
    }

    return result('', reason === 'empty' ? 'error' : reason);
  }

  function result(text: string, reason: StopReason): LoopResult {
    const out: LoopResult = {
      text,
      steps: traces.length > 0 ? traces[traces.length - 1]!.step : 0,
      stopReason: reason,
      toolCalls: traces,
      messages: transcript,
      attachments: [...collectedAttachments],
      delivered,
    };
    if (model) out.model = model;
    return out;
  }
}

/**
 * Validate + dedupe tool-supplied file references. Only http(s) URLs are
 * accepted — never model-typed strings, never local paths or schemes that
 * could make the server fetch internal resources.
 */
export function collectAttachments(
  into: ToolAttachment[],
  candidates: ToolAttachment[] | undefined,
): void {
  if (!candidates?.length) return;
  for (const c of candidates) {
    if (into.length >= MAX_TURN_ATTACHMENTS) break;
    if (!c || typeof c.url !== 'string' || !/^https?:\/\//i.test(c.url.trim())) continue;
    const url = c.url.trim().slice(0, 2048);
    if (into.some((a) => a.url === url)) continue;
    const name = (typeof c.name === 'string' && c.name.trim() ? c.name.trim() : 'file').slice(0, 120);
    into.push({ name, url });
  }
}
