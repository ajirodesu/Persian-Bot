/**
 * Agent runner — one entry point for every agent.
 *
 * Per-agent provider/model selection with `default` inheritance, JSON mode
 * with reasoning-tag stripping + parse + one repair round, model rotation
 * inside a provider before falling to the next provider, and error
 * classification so a bad API key skips the provider outright.
 *
 * Transport/retry/backoff live in provider/base.ts — this file only decides
 * *what* to call and *how to read the answer*. Never throws for transport
 * reasons without exhausting every candidate first, and never crashes the bot.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

import { extractJSON, stripReasoning, parseLabelledFields } from './sanitize.js';
import { resolveAgentConfig, buildCandidates, getProvider, BUILTIN_DEFAULTS } from './config.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import type { ChatMessage, ChatCompletionRequest, ToolDefinition, ToolChoice } from './provider/types.js';
import type { AgentConfig, AgentRequest, AgentResult } from './agent-types.js';

export class AgentError extends Error {
  attempts: number;
  override cause?: unknown;
  constructor(message: string, attempts: number, cause?: unknown) {
    super(message);
    this.name = 'AgentError';
    this.attempts = attempts;
    this.cause = cause;
  }
}

type Disposition = 'next-model' | 'next-provider' | 'retry-without-json' | 'retry-without-tools';

function classify(err: unknown): Disposition {
  const e = err as { status?: number; message?: string } | undefined;
  const status = e?.status;
  const msg = (e?.message ?? '').toLowerCase();

  if (status === 400 && (msg.includes('response_format') || msg.includes('json_object'))) {
    return 'retry-without-json';
  }
  if (
    (status === 400 || status === 404) &&
    (msg.includes('tool') || msg.includes('function call') || msg.includes('function_call'))
  ) {
    return 'retry-without-tools';
  }
  if (
    status === 401 ||
    status === 403 ||
    msg.includes('invalid api key') ||
    msg.includes('unauthorized')
  ) {
    return 'next-provider';
  }
  if (status === 404 || status === 400) return 'next-model';
  return 'next-model';
}

function toMessages(req: AgentRequest): ChatMessage[] {
  const user: ChatMessage[] =
    typeof req.user === 'string' ? [{ role: 'user', content: req.user }] : req.user;
  return [{ role: 'system', content: req.system }, ...user];
}

/** Run an agent and return raw text. */
export async function askAgentText(name: string, req: AgentRequest): Promise<AgentResult<string>> {
  return askAgentMessages(name, toMessages(req), req.overrides ?? {}, req.userId);
}

/** Same as askAgentText but takes a raw message array. */
export async function askAgentMessages(
  name: string,
  messages: ChatMessage[],
  overrides: Partial<AgentConfig> = {},
  userId?: string,
): Promise<AgentResult<string>> {
  const res = await askAgentRaw(name, messages, overrides, undefined, undefined, userId);
  const content = stripReasoning(res.data.content);

  if (!content) {
    throw new AgentError(
      `Agent "${name}" returned no text (finish_reason=${res.finishReason})`,
      res.attempts,
    );
  }
  return { ...res, data: content, raw: content };
}

/**
 * The provider walk, returning the assistant message itself. A turn that is
 * nothing but tool calls has `content: null` and must not be mistaken for an
 * empty response.
 */
export async function askAgentRaw(
  name: string,
  messages: ChatMessage[],
  overrides: Partial<AgentConfig> = {},
  tools?: ToolDefinition[],
  toolChoice?: ToolChoice,
  userId?: string,
): Promise<AgentResult<ChatMessage> & { finishReason: string | null }> {
  const cfg = resolveAgentConfig(name, overrides, userId);
  const candidates = buildCandidates(cfg, userId);

  if (candidates.length === 0) {
    throw new AgentError(
      `Agent "${name}" has no usable provider/model. Set AI_API_KEY/AI_MODEL or configure providers via the AI Agent dashboard page.`,
      0,
    );
  }

  const timeout = cfg.timeout ?? BUILTIN_DEFAULTS.timeout;
  const retryRateLimit = candidates.length <= 1;

  let attempts = 0;
  let lastError: unknown = null;
  let useJson = cfg.json === true;
  let useTools = Boolean(tools?.length);

  for (let i = 0; i < candidates.length; i++) {
    const ref = candidates[i]!;
    let skipProvider = false;

    // Up to three passes per model: as asked, without JSON mode, without
    // tools. Each downgrade covers a real capability gap between providers.
    for (let pass = 0; pass < 3; pass++) {
      attempts++;
      try {
        const provider = getProvider(ref, timeout, retryRateLimit, userId);
        const request: ChatCompletionRequest = {
          model: ref.model,
          messages,
          max_tokens: cfg.maxTokens ?? BUILTIN_DEFAULTS.maxTokens,
          temperature: cfg.temperature ?? BUILTIN_DEFAULTS.temperature,
          ...(useJson ? { response_format: { type: 'json_object' as const } } : {}),
          ...(useTools && tools?.length ? { tools, tool_choice: toolChoice ?? 'auto' } : {}),
        };

        const res = await provider.chat(request);
        const choice = res.choices?.[0];
        const message = choice?.message;
        const hasToolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
        const content = stripReasoning(message?.content);

        if (!content && !hasToolCalls) {
          logger.warn(
            `[agent:${name}] ${ref.provider}/${ref.model} returned empty (finish_reason=${choice?.finish_reason}) — next model`,
          );
          break;
        }

        logger.info(
          `[agent:${name}] ${ref.provider}/${ref.model} ok (${attempts} attempt${attempts === 1 ? '' : 's'}${hasToolCalls ? `, ${message!.tool_calls!.length} tool call(s)` : ''})`,
        );

        return {
          data: {
            role: 'assistant',
            content: content || null,
            ...(hasToolCalls ? { tool_calls: message!.tool_calls } : {}),
          },
          raw: content,
          provider: ref.provider,
          model: ref.model,
          attempts,
          finishReason: choice?.finish_reason ?? null,
          toolsUsed: useTools,
        } as AgentResult<ChatMessage> & { finishReason: string | null; toolsUsed: boolean };
      } catch (err) {
        lastError = err;
        const disposition = classify(err);
        const reason = (err as Error)?.message?.slice(0, 160);

        if (disposition === 'retry-without-json' && useJson) {
          logger.warn(`[agent:${name}] ${ref.provider} rejected json mode — retrying without it`);
          useJson = false;
          continue;
        }
        if (disposition === 'retry-without-tools' && useTools) {
          logger.warn(
            `[agent:${name}] ${ref.provider}/${ref.model} does not support tool calling — retrying without it`,
          );
          useTools = false;
          continue;
        }
        if (disposition === 'next-provider') {
          logger.warn(`[agent:${name}] ${ref.provider} credentials rejected — skipping provider (${reason})`);
          skipProvider = true;
        } else {
          logger.warn(`[agent:${name}] ${ref.provider}/${ref.model} failed — next model (${reason})`);
        }
        break;
      }
    }

    if (skipProvider) {
      while (i + 1 < candidates.length && candidates[i + 1]!.provider === ref.provider) i++;
    }
  }

  throw new AgentError(
    `Agent "${name}" exhausted all ${candidates.length} provider/model candidates`,
    attempts,
    lastError,
  );
}

/**
 * Run an agent that must answer with JSON. `validate` is mandatory: agent
 * output drives moderation actions, so every caller states what valid output
 * looks like. Never trusts model output blindly — one repair round, then an
 * optional labelled-lines fallback for models that cannot emit JSON.
 */
export async function askAgentJSON<T>(
  name: string,
  req: AgentRequest,
  validate: (raw: unknown) => T,
  fields?: string[],
): Promise<AgentResult<T>> {
  const jsonReq: AgentRequest = {
    ...req,
    system: `${req.system}\n\nRespond with a single valid JSON object and nothing else. No prose, no markdown fences, no explanation outside the JSON.`,
    overrides: { json: true, ...(req.overrides ?? {}) },
  };

  const first = await askAgentText(name, { ...jsonReq, userId: req.userId });
  const parsed = extractJSON(first.raw);
  if (parsed !== null) {
    return { ...first, data: validate(parsed) };
  }

  logger.warn(`[agent:${name}] response was not valid JSON — attempting one repair round`);

  const repair = await askAgentText(name, {
    system:
      'You convert malformed output into valid JSON. Output the corrected JSON object only — no prose, no fences.',
    user: `The following was supposed to be a single JSON object but did not parse. Return the corrected JSON:\n\n${first.raw.slice(0, 2000)}`,
    overrides: { json: true, temperature: 0 },
    userId: req.userId,
  });

  const repaired = extractJSON(repair.raw);
  if (repaired !== null) {
    return { ...repair, data: validate(repaired), attempts: first.attempts + repair.attempts };
  }

  if (fields?.length) {
    logger.warn(`[agent:${name}] JSON failed twice — asking for labelled fields instead`);

    const labelled = await askAgentText(name, {
      system: `Answer using exactly these lines and nothing else:\n${fields.map((f) => `${f.toUpperCase()}: <value>`).join('\n')}`,
      user:
        typeof req.user === 'string'
          ? req.user
          : req.user.map((m) => m.content ?? '').join('\n'),
      overrides: { json: false, temperature: 0 },
      userId: req.userId,
    });

    const labelledParsed = parseLabelledFields(labelled.raw, fields);
    if (labelledParsed) {
      return {
        ...labelled,
        data: validate(labelledParsed),
        attempts: first.attempts + repair.attempts + labelled.attempts,
      };
    }
  }

  throw new AgentError(
    `Agent "${name}" did not return parseable JSON after a repair round`,
    first.attempts + repair.attempts,
  );
}
