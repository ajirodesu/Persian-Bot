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
import type { ToolContext } from './agent-tool.types.js';

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
}

// Sentinel returned to the LLM when run_command is intercepted.
const RUN_CMD_SENTINEL = '__RUN_COMMAND_DISPATCHED__';

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

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
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
    const response = await client.chat.completions.create({
      model,
      messages,
      // exactOptionalPropertyTypes: only attach tools/tool_choice when present.
      ...(oaTools ? { tools: oaTools, tool_choice: 'auto' as const } : {}),
    });

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

    let commandDispatched = false;
    for (const tc of msg.tool_calls) {
      // openai v6 unions custom tool calls in — only handle function calls.
      if (tc.type !== 'function') continue;
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
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      if (result === RUN_CMD_SENTINEL) commandDispatched = true;
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

  const contents: any[] = [
    ...history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: userParts },
  ];

  for (let i = 0; i < maxToolIterations; i++) {
    const response = await client.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: systemPrompt,
        ...(functionDeclarations.length > 0
          ? ({ tools: [{ functionDeclarations }] } as any)
          : {}),
      } as any,
    });

    const parts: any[] = response.candidates?.[0]?.content?.parts ?? [];
    const textPart = parts.find((p: any) => typeof p.text === 'string');
    const callParts = parts.filter((p: any) => p.functionCall);

    if (callParts.length === 0) {
      return textPart?.text ?? null;
    }

    contents.push({ role: 'model', parts });

    let commandDispatched = false;
    const responseParts: any[] = [];
    for (const part of callParts) {
      const fc = part.functionCall;
      const result = await execFn(
        fc.name,
        (fc.args ?? {}) as Record<string, unknown>,
      );
      logger.debug('[AgentTool]', `${fc.name} → ${result.slice(0, 80)}`);
      responseParts.push({
        functionResponse: { name: fc.name, response: { result } },
      });
      if (result === RUN_CMD_SENTINEL) commandDispatched = true;
    }
    contents.push({ role: 'user', parts: responseParts });

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
    toolLog.push({ name, args, result: result.slice(0, 400) });
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
        text = await runOpenAILike(
          cfg.provider,
          cfg.apiKey,
          cfg.model,
          cfg.systemPrompt,
          cfg.history,
          cfg.userQuery,
          cfg.tools,
          execFn,
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
