import { getAiAgentSettings } from '@/engine/repos/ai-agent-config.repo.js';
import type { NeedleToolDefinition } from './tool-schema.lib.js';

/**
 * Needle 3 client — Persian-Bot → separately hosted Cactus Needle 3 service.
 *
 * Transport: authenticated HTTPS (Bearer token), one stateful Needle turn per
 * request. Multi-turn execution is driven from `agent.ts`: each turn's
 * `function_calls` are executed LOCALLY (help/test_command/send_result need
 * the AppCtx) and the JSON-encoded tool results are fed back as the next
 * turn's input — the documented Needle multi-turn pattern
 * (`complete(query)` → `complete(json(tool_output))` on the same instance;
 * the service keeps one `Needle` instance per session id).
 *
 * Safety:
 *   - request timeout + connection timeout via AbortController
 *   - bounded retry: exactly one retry on network errors / timeouts / 5xx;
 *     NEVER retried on 401 (auth failure) or 4xx (invalid input)
 *   - malformed-response detection (non-dict result, missing function_calls)
 *   - never blocks the event loop; never retries infinitely
 */

export type NeedleClientErrorCode =
  | 'DISABLED'
  | 'INCOMPLETE_CONFIG'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'UNAUTHORIZED'
  | 'INVALID'
  | 'MALFORMED';

export class NeedleClientError extends Error {
  readonly code: NeedleClientErrorCode;
  constructor(code: NeedleClientErrorCode, message: string) {
    super(message);
    this.name = 'NeedleClientError';
    this.code = code;
  }
}

export interface NeedleConfig {
  enabled: boolean;
  url: string;
  token: string;
  timeoutMs: number;
  confidenceThreshold: number;
  tokenConfigured: boolean;
}

/** Resolves effective config: DB store (dashboard) wins, env is the fallback. */
export async function resolveNeedleConfig(): Promise<NeedleConfig> {
  const envEnabled = process.env['NEEDLE_ENABLED'] === 'true';
  const envUrl = (process.env['NEEDLE_URL'] ?? '').trim();
  const envToken = (process.env['NEEDLE_AUTH_TOKEN'] ?? '').trim();
  const envTimeout = parseInt(process.env['NEEDLE_TIMEOUT_MS'] ?? '', 10);
  const envConfidence = parseFloat(
    process.env['NEEDLE_CONFIDENCE_THRESHOLD'] ?? '',
  );

  let store: Awaited<ReturnType<typeof getAiAgentSettings>> | null;
  try {
    store = await getAiAgentSettings();
  } catch {
    store = null; // fail-open to env — a DB outage must not break AI config reads
  }

  const url = (store?.needleUrl ?? envUrl).trim().replace(/\/+$/, '');
  const token = store?.token ?? envToken;
  return {
    enabled: store ? store.enabled : envEnabled,
    url,
    token,
    timeoutMs:
      store?.timeoutMs ??
      (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 30000),
    confidenceThreshold:
      store?.confidenceThreshold ??
      (Number.isFinite(envConfidence) && envConfidence >= 0 && envConfidence <= 1
        ? envConfidence
        : 0.7),
    tokenConfigured: token !== '',
  };
}

function requireUsable(cfg: NeedleConfig): void {
  if (!cfg.enabled) {
    throw new NeedleClientError('DISABLED', 'AI Agent is disabled.');
  }
  if (!cfg.url || !cfg.tokenConfigured) {
    throw new NeedleClientError(
      'INCOMPLETE_CONFIG',
      'Needle 3 connection is not configured (URL and token required).',
    );
  }
}

export interface NeedleFunctionCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** Verbatim subset of the documented Needle 3 turn dict. */
export interface NeedleTurnResult {
  type: string;
  success: boolean;
  error: string | null;
  errorCode: string | null;
  functionCalls: NeedleFunctionCall[];
  reasoning: string | null;
  confidence: number | null;
  suppressedCalls: unknown[] | null;
  validation: Record<string, unknown> | null;
}

function parseTurnResult(raw: unknown): NeedleTurnResult {
  if (!raw || typeof raw !== 'object') {
    throw new NeedleClientError('MALFORMED', 'Needle 3 returned a malformed response.');
  }
  const r = raw as Record<string, unknown>;
  const callsRaw = r['function_calls'];
  const functionCalls: NeedleFunctionCall[] = [];
  if (Array.isArray(callsRaw)) {
    for (const c of callsRaw) {
      if (!c || typeof c !== 'object') continue;
      const entry = c as Record<string, unknown>;
      if (typeof entry['name'] !== 'string') continue;
      let args: Record<string, unknown> = {};
      const rawArgs = entry['arguments'];
      if (typeof rawArgs === 'string') {
        try {
          const parsed: unknown = JSON.parse(rawArgs);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            args = parsed as Record<string, unknown>;
          }
        } catch {
          continue; // unparseable arguments → drop this call, never crash
        }
      } else if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
        args = rawArgs as Record<string, unknown>;
      }
      functionCalls.push({ name: entry['name'], arguments: args });
    }
  } else if (callsRaw !== undefined && callsRaw !== null) {
    throw new NeedleClientError(
      'MALFORMED',
      'Needle 3 returned a malformed response (function_calls).',
    );
  }
  const confidenceRaw = r['confidence'];
  return {
    type: typeof r['type'] === 'string' ? r['type'] : 'respond',
    success: r['success'] !== false,
    error: typeof r['error'] === 'string' ? r['error'] : null,
    errorCode: typeof r['error_code'] === 'string' ? r['error_code'] : null,
    functionCalls,
    reasoning: typeof r['reasoning'] === 'string' ? r['reasoning'] : null,
    confidence:
      typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)
        ? confidenceRaw
        : null,
    suppressedCalls: Array.isArray(r['suppressed_calls'])
      ? (r['suppressed_calls'] as unknown[])
      : null,
    validation:
      r['validation'] && typeof r['validation'] === 'object'
        ? (r['validation'] as Record<string, unknown>)
        : null,
  };
}

async function postJson(
  url: string,
  token: string,
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ status: number; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  (timer as NodeJS.Timeout).unref?.();
  try {
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new NeedleClientError(
        'TIMEOUT',
        `Needle 3 request timed out after ${timeoutMs}ms.`,
      );
    }
    throw new NeedleClientError(
      'UNAVAILABLE',
      `Needle 3 service unreachable: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

function throwForStatus(status: number, data: unknown): void {
  if (status === 401 || status === 403) {
    throw new NeedleClientError(
      'UNAUTHORIZED',
      'Needle 3 rejected authentication (check NEEDLE_AUTH_TOKEN).',
    );
  }
  if (status === 400) {
    const msg =
      data && typeof data === 'object' && typeof (data as Record<string, unknown>)['error'] === 'string'
        ? ((data as Record<string, unknown>)['error'] as string)
        : 'invalid request';
    throw new NeedleClientError('INVALID', `Needle 3 rejected the request: ${msg}`);
  }
  if (status >= 500) {
    throw new NeedleClientError(
      'UNAVAILABLE',
      `Needle 3 service error (HTTP ${status}).`,
    );
  }
  if (status !== 200) {
    throw new NeedleClientError(
      'MALFORMED',
      `Needle 3 returned unexpected HTTP ${status}.`,
    );
  }
}

/** Executes exactly ONE Needle turn (bounded single retry on 5xx/network). */
export async function completeTurn(opts: {
  sessionId: string;
  system: string;
  tools: NeedleToolDefinition[];
  input: string;
  maxNewTokens?: number;
  config?: NeedleConfig;
}): Promise<NeedleTurnResult> {
  const cfg = opts.config ?? (await resolveNeedleConfig());
  requireUsable(cfg);
  const body = {
    session_id: opts.sessionId,
    system: opts.system,
    tools: opts.tools,
    input: opts.input,
    ...(opts.maxNewTokens !== undefined ? { max_new_tokens: opts.maxNewTokens } : {}),
  };
  let attempt = 0;
  for (;;) {
    attempt += 1;
    let res: { status: number; data: unknown };
    try {
      res = await postJson(cfg.url, cfg.token, '/v1/agent/complete', body, cfg.timeoutMs);
    } catch (err) {
      // Bounded retry: one extra attempt on transient failures only.
      if (
        attempt === 1 &&
        err instanceof NeedleClientError &&
        (err.code === 'UNAVAILABLE' || err.code === 'TIMEOUT')
      ) {
        continue;
      }
      throw err;
    }
    if (res.status >= 500 && attempt === 1) continue; // one retry on 5xx
    throwForStatus(res.status, res.data);
    const result =
      res.data && typeof res.data === 'object'
        ? (res.data as Record<string, unknown>)['result']
        : null;
    return parseTurnResult(result);
  }
}

/** Clears server-side conversation state for a session (best-effort). */
export async function resetSession(
  sessionId: string,
  config?: NeedleConfig,
): Promise<void> {
  const cfg = config ?? (await resolveNeedleConfig());
  requireUsable(cfg);
  try {
    await postJson(cfg.url, cfg.token, '/v1/agent/reset', { session_id: sessionId }, Math.min(cfg.timeoutMs, 10000));
  } catch {
    /* best-effort — session TTL on the service bounds stale state */
  }
}

export interface NeedleCapabilities {
  toolCalling: boolean;
  mcp: boolean;
  skills: boolean;
  mcpReason?: string;
  skillsReason?: string;
  generation?: number;
  needleVersion?: string;
  runtimeAvailable?: boolean;
}

export type ConnectionStatus =
  | 'Connected'
  | 'Disconnected'
  | 'Unauthorized'
  | 'Unavailable'
  | 'Configuration incomplete'
  | 'Unsupported'
  | 'Disabled';

/** Real authenticated capability probe — never faked. */
export async function fetchCapabilities(
  config?: NeedleConfig,
): Promise<{ status: ConnectionStatus; capabilities: NeedleCapabilities | null }> {
  const cfg = config ?? (await resolveNeedleConfig());
  if (!cfg.enabled) return { status: 'Disabled', capabilities: null };
  if (!cfg.url || !cfg.tokenConfigured) {
    return { status: 'Configuration incomplete', capabilities: null };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(cfg.timeoutMs, 15000));
  (timer as NodeJS.Timeout).unref?.();
  try {
    const res = await fetch(`${cfg.url}/capabilities`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { status: 'Unauthorized', capabilities: null };
    }
    if (!res.ok) return { status: 'Unavailable', capabilities: null };
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      return { status: 'Unavailable', capabilities: null };
    }
    const d = (data ?? {}) as Record<string, unknown>;
    const capabilities: NeedleCapabilities = {
      toolCalling: d['toolCalling'] === true,
      mcp: d['mcp'] === true,
      skills: d['skills'] === true,
      ...(typeof d['mcpReason'] === 'string' ? { mcpReason: d['mcpReason'] } : {}),
      ...(typeof d['skillsReason'] === 'string' ? { skillsReason: d['skillsReason'] } : {}),
      ...(typeof d['generation'] === 'number' ? { generation: d['generation'] } : {}),
      ...(typeof d['needleVersion'] === 'string' ? { needleVersion: d['needleVersion'] } : {}),
      ...(typeof d['runtimeAvailable'] === 'boolean' ? { runtimeAvailable: d['runtimeAvailable'] } : {}),
    };
    if (!capabilities.toolCalling || capabilities.runtimeAvailable === false) {
      return { status: 'Unsupported', capabilities };
    }
    return { status: 'Connected', capabilities };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { status: 'Unavailable', capabilities: null };
    }
    return { status: 'Disconnected', capabilities: null };
  } finally {
    clearTimeout(timer);
  }
}
