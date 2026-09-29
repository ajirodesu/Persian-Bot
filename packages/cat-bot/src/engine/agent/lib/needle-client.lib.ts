import { randomUUID } from 'node:crypto';
import { getAiAgentSettings } from '@/engine/repos/ai-agent-config.repo.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import type { NeedleToolDefinition } from './tool-schema.lib.js';

/**
 * Needle 3 client — Persian-Bot → standalone Wataru Needle 3 Render API.
 *
 * Live contract (verified against https://wataru-needle-3-api.onrender.com):
 *   GET  /health       → {ok, model: "needle3", generation: 3, package_version}
 *                          (503 while uninitialized — degraded, not ready)
 *   POST /v1/complete  → native Needle turn dict, verbatim:
 *     {type, success, error, error_code, reason, function_calls: [{name,
 *      arguments: {...}}], suppressed_calls, reasoning, confidence,
 *      validation, prefill_tps, decode_tps, peak_ram_mb}
 *
 * Auth: `Authorization: Bearer ${NEEDLE_API_KEY}` (the server also accepts
 * `X-API-Key`, but Bearer is canonical here). The key comes ONLY from the
 * environment / encrypted dashboard store — it is never hardcoded, never
 * logged, and never echoed back to any caller.
 *
 * The service is stateless per request (it resets its agent on every call),
 * so multi-turn is driven here: agent.ts carries the full local transcript
 * in `query` (with `system` for the stable prompt head) on every turn.
 * There is no remote session to create, reset, or leak across users.
 *
 * Render Free notes: the instance sleeps when idle (cold-start latency) —
 * the default 30 s timeout tolerates a slow wake-up, 5xx gets ONE retry,
 * and timeouts are never retried (a timed-out inference may still be
 * running server-side; re-firing just queues duplicate work).
 */

export type NeedleClientErrorCode =
  | 'DISABLED'
  | 'INCOMPLETE_CONFIG'
  | 'UNRESOLVABLE'
  | 'REFUSED'
  | 'TIMEOUT'
  | 'SERVICE_UNAVAILABLE'
  | 'ENDPOINT_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INVALID'
  | 'NEEDLE_ERROR'
  | 'MALFORMED';

export class NeedleClientError extends Error {
  readonly code: NeedleClientErrorCode;
  constructor(code: NeedleClientErrorCode, message: string) {
    super(message);
    this.name = 'NeedleClientError';
    this.code = code;
  }
}

export type NeedleAuthMode = 'none' | 'token';

export interface NeedleConfig {
  enabled: boolean;
  /** Normalized base URL (no trailing slash, no endpoint suffix). */
  url: string;
  /** API key (NEEDLE_API_KEY). Empty when unconfigured. Never log this. */
  token: string;
  timeoutMs: number;
  /** Per-request inference budget forwarded as max_new_tokens (1–512). */
  maxNewTokens: number;
  confidenceThreshold: number;
  tokenConfigured: boolean;
  authMode: NeedleAuthMode;
}

/** Render Free cold starts need room, but requests must stay bounded. */
export const DEFAULT_TIMEOUT_MS = 30000;
export const MAX_TIMEOUT_MS = 120000;
export const MIN_TIMEOUT_MS = 1000;
export const DEFAULT_MAX_NEW_TOKENS = 256;
export const MAX_ALLOWED_TOKENS = 512;
const HEALTH_PROBE_TIMEOUT_MS = 15000;
const CAPABILITY_CACHE_TTL_MS = 5 * 60 * 1000;

/** Normalizes the stored base URL. Never appends an endpoint path. */
export function normalizeBaseUrl(raw: string): string {
  return (raw ?? '').trim().replace(/\/+$/, '');
}

function clampTimeout(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(raw)));
}

function clampMaxTokens(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_MAX_NEW_TOKENS;
  return Math.min(
    MAX_ALLOWED_TOKENS,
    Math.max(1, Math.round(raw)),
  );
}

/** Resolves effective config: DB store (dashboard) wins, env is the fallback. */
export async function resolveNeedleConfig(): Promise<NeedleConfig> {
  const envEnabled = process.env['NEEDLE_ENABLED'] === 'true';
  const envUrl = normalizeBaseUrl(process.env['NEEDLE_URL'] ?? '');
  // Canonical key first; legacy NEEDLE_AUTH_TOKEN kept as a silent fallback
  // so existing deployments do not break on upgrade.
  const envToken = (
    process.env['NEEDLE_API_KEY'] ??
    process.env['NEEDLE_AUTH_TOKEN'] ??
    ''
  ).trim();
  const envTimeout = parseInt(process.env['NEEDLE_TIMEOUT_MS'] ?? '', 10);
  const envTokens = parseInt(process.env['NEEDLE_MAX_NEW_TOKENS'] ?? '', 10);
  const envConfidence = parseFloat(
    process.env['NEEDLE_CONFIDENCE_THRESHOLD'] ?? '',
  );

  let store: Awaited<ReturnType<typeof getAiAgentSettings>> | null;
  try {
    store = await getAiAgentSettings();
  } catch {
    store = null; // fail-open to env — a DB outage must not break AI config reads
  }

  const url = normalizeBaseUrl(store?.needleUrl ?? envUrl);
  const token = (store?.token ?? envToken).trim();
  return {
    enabled: store ? store.enabled : envEnabled,
    url,
    token,
    timeoutMs: clampTimeout(store?.timeoutMs ?? envTimeout),
    maxNewTokens: clampMaxTokens(store?.maxNewTokens ?? envTokens),
    confidenceThreshold:
      store?.confidenceThreshold ??
      (Number.isFinite(envConfidence) && envConfidence >= 0 && envConfidence <= 1
        ? envConfidence
        : 0.7),
    tokenConfigured: token !== '',
    authMode: token !== '' ? 'token' : 'none',
  };
}

function requireUsable(cfg: NeedleConfig): void {
  if (!cfg.enabled) {
    throw new NeedleClientError('DISABLED', 'AI Agent is disabled.');
  }
  if (!cfg.url) {
    throw new NeedleClientError(
      'INCOMPLETE_CONFIG',
      'Needle 3 service URL is not configured.',
    );
  }
  if (!/^https?:\/\//i.test(cfg.url)) {
    throw new NeedleClientError(
      'INVALID',
      'Needle 3 URL must be an absolute http(s) URL.',
    );
  }
}

export interface NeedleFunctionCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** Verbatim subset of the native Needle 3 turn dict. */
export interface NeedleTurnResult {
  type: string;
  success: boolean;
  error: string | null;
  errorCode: string | null;
  reason: string | null;
  functionCalls: NeedleFunctionCall[];
  reasoning: string | null;
  confidence: number | null;
  suppressedCalls: unknown[] | null;
  validation: Record<string, unknown> | null;
}

export function parseTurnResult(raw: unknown): NeedleTurnResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new NeedleClientError('MALFORMED', 'Needle 3 returned a malformed response.');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r['error'] === 'string' && r['error'] !== '') {
    throw new NeedleClientError(
      'NEEDLE_ERROR',
      `Needle service returned an error: ${r['error']}`,
    );
  }
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
  const reasonRaw = r['reason'];
  return {
    type: typeof r['type'] === 'string' ? r['type'] : 'respond',
    success: r['success'] !== false,
    error: typeof r['error'] === 'string' ? r['error'] : null,
    errorCode: typeof r['error_code'] === 'string' ? r['error_code'] : null,
    reason: typeof reasonRaw === 'string' ? reasonRaw : null,
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

function authHeaders(cfg: NeedleConfig): Record<string, string> {
  // NEEDLE_API_KEY only, and only when configured. Never logged (see
  // logProbe — it records baseUrl/path/status/duration, never headers).
  return cfg.tokenConfigured ? { Authorization: `Bearer ${cfg.token}` } : {};
}

/** Maps fetch/network failures to precise, non-collapsed error codes. */
function mapNetworkError(err: unknown, timeoutMs: number): NeedleClientError {
  const e = err as { name?: string; cause?: { code?: string }; code?: string };
  if (e?.name === 'AbortError') {
    return new NeedleClientError(
      'TIMEOUT',
      `Needle 3 request timed out after ${timeoutMs}ms.`,
    );
  }
  const code = e?.cause?.code ?? e?.code ?? '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new NeedleClientError(
      'UNRESOLVABLE',
      'Cannot resolve host: check the Needle 3 service URL.',
    );
  }
  if (code === 'ECONNREFUSED') {
    throw new NeedleClientError(
      'REFUSED',
      'Connection refused: the Needle 3 service is not accepting connections.',
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return new NeedleClientError(
    'SERVICE_UNAVAILABLE',
    `Needle 3 service unavailable: ${message}`,
  );
}

function throwForStatus(
  status: number,
  path: string,
  data: unknown,
): void {
  if (status === 401 || status === 403) {
    throw new NeedleClientError(
      'UNAUTHORIZED',
      'Needle 3 rejected authentication (check NEEDLE_API_KEY).',
    );
  }
  if (status === 404) {
    throw new NeedleClientError(
      'ENDPOINT_NOT_FOUND',
      `Endpoint not found (${path}) — is this a Needle 3 server?`,
    );
  }
  if (status === 400) {
    const msg =
      data && typeof data === 'object' && typeof (data as Record<string, unknown>)['error'] === 'string'
        ? ((data as Record<string, unknown>)['error'] as string)
        : 'invalid request';
    throw new NeedleClientError('INVALID', `Needle 3 rejected the request: ${msg}`);
  }
  if (status === 503) {
    throw new NeedleClientError(
      'SERVICE_UNAVAILABLE',
      'Needle 3 is starting up or not configured (cold start / degraded).',
    );
  }
  if (status >= 500) {
    throw new NeedleClientError(
      'SERVICE_UNAVAILABLE',
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

interface RawResponse {
  status: number;
  data: unknown;
  latencyMs: number;
}

/** Server-side diagnostics (never includes tokens or auth headers). */
function logProbe(opts: {
  baseUrl: string;
  path: string;
  status: number | string;
  durationMs: number;
  model?: string;
}): void {
  logger.info('[Needle] probe', {
    baseUrl: opts.baseUrl,
    path: opts.path,
    status: opts.status,
    durationMs: Math.round(opts.durationMs),
    ...(opts.model ? { model: opts.model } : {}),
  });
}

async function requestJson(opts: {
  cfg: NeedleConfig;
  path: '/v1/complete' | '/health';
  method: 'GET' | 'POST';
  body?: Record<string, unknown>;
  timeoutMs: number;
  /** Single retry on 5xx only (never 401/4xx, never timeouts). */
  retryTransient?: boolean;
}): Promise<RawResponse> {
  const started = Date.now();
  const url = `${opts.cfg.url}${opts.path}`;
  const requestId = randomUUID();
  const attempt = async (): Promise<RawResponse> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    (timer as NodeJS.Timeout).unref?.();
    try {
      const res = await fetch(url, {
        method: opts.method,
        headers: {
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...authHeaders(opts.cfg),
          'X-Request-ID': requestId,
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        signal: controller.signal,
      });
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      const latencyMs = Date.now() - started;
      throwForStatus(res.status, opts.path, data);
      logProbe({
        baseUrl: opts.cfg.url,
        path: opts.path,
        status: res.status,
        durationMs: latencyMs,
      });
      return { status: res.status, data, latencyMs };
    } catch (err) {
      if (err instanceof NeedleClientError) {
        if (!(err.code === 'TIMEOUT' || err.code === 'SERVICE_UNAVAILABLE')) {
          logProbe({
            baseUrl: opts.cfg.url,
            path: opts.path,
            status: err.code,
            durationMs: Date.now() - started,
          });
        }
        throw err;
      }
      throw mapNetworkError(err, opts.timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await attempt();
  } catch (err) {
    // Single retry on 5xx only. Timeouts are NOT retried: a timed-out
    // inference may still be processing server-side, so retrying just
    // queues duplicate work (and hammers a Free-tier instance).
    const retryable =
      err instanceof NeedleClientError && err.code === 'SERVICE_UNAVAILABLE';
    if (opts.retryTransient !== false && retryable) {
      return attempt();
    }
    throw err;
  }
}

export interface CompleteTurnOptions {
  query: string;
  /** Stable prompt head (system prompt + catalogue). Sent as `system`. */
  system?: string;
  tools: NeedleToolDefinition[];
  /** Overrides the configured max_new_tokens for this turn. */
  maxNewTokens?: number;
  config?: NeedleConfig;
}

/** One Needle inference turn: POST {base}/v1/complete. */
export async function completeTurn(opts: CompleteTurnOptions): Promise<{
  turn: NeedleTurnResult;
  latencyMs: number;
}> {
  const cfg = opts.config ?? (await resolveNeedleConfig());
  requireUsable(cfg);
  if (typeof opts.query !== 'string' || opts.query.trim() === '') {
    throw new NeedleClientError('INVALID', 'query must be a non-empty string.');
  }
  const res = await requestJson({
    cfg,
    path: '/v1/complete',
    method: 'POST',
    body: {
      query: opts.query,
      ...(opts.system !== undefined && opts.system !== ''
        ? { system: opts.system }
        : {}),
      tools: opts.tools,
      max_new_tokens:
        opts.maxNewTokens !== undefined
          ? clampMaxTokens(opts.maxNewTokens)
          : cfg.maxNewTokens,
    },
    timeoutMs: cfg.timeoutMs,
  });
  const result =
    res.data && typeof res.data === 'object'
      ? (res.data as Record<string, unknown>)
      : null;
  return { turn: parseTurnResult(result), latencyMs: res.latencyMs };
}

export interface NeedleHealth {
  ok: boolean;
  model: string | null;
  generation: number | null;
  packageVersion: string | null;
}

/**
 * Liveness probe: GET {base}/health. Asserts model = needle3,
 * generation = 3. 503 = degraded/starting (mapped to SERVICE_UNAVAILABLE).
 */
export async function checkHealth(config?: NeedleConfig): Promise<{
  health: NeedleHealth;
  latencyMs: number;
}> {
  const cfg = config ?? (await resolveNeedleConfig());
  requireUsable(cfg);
  const res = await requestJson({
    cfg,
    path: '/health',
    method: 'GET',
    timeoutMs: Math.min(cfg.timeoutMs, HEALTH_PROBE_TIMEOUT_MS),
    retryTransient: false,
  });
  const data = (res.data ?? {}) as Record<string, unknown>;
  const health: NeedleHealth = {
    ok: data['ok'] === true,
    model: typeof data['model'] === 'string' ? data['model'] : null,
    generation: typeof data['generation'] === 'number' ? data['generation'] : null,
    packageVersion:
      typeof data['package_version'] === 'string' ? data['package_version'] : null,
  };
  if (health.model !== null && health.model !== 'needle3') {
    throw new NeedleClientError(
      'INVALID',
      `Unexpected Needle model: ${health.model} (expected needle3).`,
    );
  }
  if (health.generation !== null && health.generation !== 3) {
    throw new NeedleClientError(
      'INVALID',
      `Unexpected Needle generation: ${health.generation} (expected 3).`,
    );
  }
  logProbe({
    baseUrl: cfg.url,
    path: '/health',
    status: res.status,
    durationMs: res.latencyMs,
    ...(health.model ? { model: health.model } : {}),
  });
  return { health, latencyMs: res.latencyMs };
}

export interface NeedleCapabilities {
  toolCalling: boolean;
  mcp: boolean;
  skills: boolean;
  mcpReason?: string;
  skillsReason?: string;
  /** Loaded model name from GET /health (only what the service returns). */
  model?: string;
}

export type ConnectionStatus =
  | 'Connected'
  | 'Disconnected'
  | 'Unauthorized'
  | 'Service unavailable'
  | 'Endpoint not found'
  | 'Configuration incomplete'
  | 'Unsupported'
  | 'Disabled';

export interface ConnectionProbe {
  status: ConnectionStatus;
  /** Precise human-readable reason (never collapsed, never a secret). */
  detail: string | null;
  capabilities: NeedleCapabilities | null;
  model: string | null;
  endpoint: string | null;
  latencyMs: number | null;
  lastCheckedAt: string;
}

function statusForError(err: unknown): {
  status: ConnectionStatus;
  detail: string;
} {
  if (err instanceof NeedleClientError) {
    const detail = err.message;
    switch (err.code) {
      case 'DISABLED':
        return { status: 'Disabled', detail };
      case 'INCOMPLETE_CONFIG':
      case 'INVALID':
        return { status: 'Configuration incomplete', detail };
      case 'UNRESOLVABLE':
      case 'REFUSED':
        return { status: 'Disconnected', detail };
      case 'UNAUTHORIZED':
        return { status: 'Unauthorized', detail };
      case 'TIMEOUT':
      case 'SERVICE_UNAVAILABLE':
      case 'NEEDLE_ERROR':
        return { status: 'Service unavailable', detail };
      case 'ENDPOINT_NOT_FOUND':
        return { status: 'Endpoint not found', detail };
      case 'MALFORMED':
        return { status: 'Unsupported', detail };
    }
  }
  return {
    status: 'Service unavailable',
    detail: err instanceof Error ? err.message : String(err),
  };
}

let cachedProbe: { at: number; probe: ConnectionProbe } | null = null;

/** Clears the cached probe (tests / settings changes). */
export function clearProbeCacheForTests(): void {
  cachedProbe = null;
}

/**
 * Real connection probe: GET /health (liveness + model/generation proof)
 * then POST /v1/complete with an empty toolset (real inference proof).
 * Only a successful /v1/complete yields Connected. Results are cached
 * 5 minutes for page loads; Test Connection bypasses the cache.
 */
export async function probeConnection(opts?: {
  config?: NeedleConfig;
  bypassCache?: boolean;
}): Promise<ConnectionProbe> {
  const cfg = opts?.config ?? (await resolveNeedleConfig());
  const now = Date.now();
  if (
    !opts?.bypassCache &&
    cachedProbe &&
    now - cachedProbe.at < CAPABILITY_CACHE_TTL_MS
  ) {
    return cachedProbe.probe;
  }

  const stamp = () => new Date().toISOString();
  try {
    requireUsable(cfg);
  } catch (err) {
    const mapped = statusForError(err);
    return {
      ...mapped,
      capabilities: null,
      model: null,
      endpoint: null,
      latencyMs: null,
      lastCheckedAt: stamp(),
    };
  }

  let health: NeedleHealth;
  try {
    ({ health } = await checkHealth(cfg));
  } catch (err) {
    const mapped = statusForError(err);
    return {
      ...mapped,
      capabilities: null,
      model: null,
      endpoint: null,
      latencyMs: null,
      lastCheckedAt: stamp(),
    };
  }
  const model = health.model;

  try {
    const res = await requestJson({
      cfg,
      path: '/v1/complete',
      method: 'POST',
      body: {
        query: 'connection check',
        tools: [],
        max_new_tokens: Math.min(cfg.maxNewTokens, 32),
      },
      timeoutMs: cfg.timeoutMs,
    });
    const turn = parseTurnResult(res.data);
    void turn;
    const probe: ConnectionProbe = {
      status: 'Connected',
      detail: null,
      capabilities: {
        toolCalling: true,
        mcp: false,
        skills: false,
        mcpReason: 'Not supported by this Needle 3 build',
        skillsReason: 'Not supported by this Needle 3 build',
        ...(model ? { model } : {}),
      },
      model,
      endpoint: '/v1/complete',
      latencyMs: res.latencyMs,
      lastCheckedAt: stamp(),
    };
    cachedProbe = { at: now, probe };
    return probe;
  } catch (err) {
    const mapped = statusForError(err);
    return {
      ...mapped,
      capabilities: {
        toolCalling: false,
        mcp: false,
        skills: false,
        mcpReason: 'Not supported by this Needle 3 build',
        skillsReason: 'Not supported by this Needle 3 build',
        ...(model ? { model } : {}),
      },
      model,
      endpoint: null,
      latencyMs: null,
      lastCheckedAt: stamp(),
    };
  }
}

export interface NeedleRemoteCapabilities {
  model: string | null;
  generation: number | null;
  packageVersion: string | null;
  toolCalling: boolean;
  streaming: boolean;
  queueDepth: number | null;
  uptimeS: number | null;
  initialized: boolean | null;
}

/**
 * Live server capabilities: GET {base}/v1/capabilities. Additive read-only
 * view for the admin dashboard — never throws for missing fields, maps HTTP
 * errors to NeedleClientError like the rest of this client.
 */
export async function fetchRemoteCapabilities(
  config?: NeedleConfig,
): Promise<{ capabilities: NeedleRemoteCapabilities; latencyMs: number }> {
  const cfg = config ?? (await resolveNeedleConfig());
  requireUsable(cfg);
  const started = Date.now();
  const url = `${cfg.url}/v1/capabilities`;
  const controller = new AbortController();
  const timeoutMs = Math.min(cfg.timeoutMs, HEALTH_PROBE_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  (timer as NodeJS.Timeout).unref?.();
  try {
    const http = await fetch(url, {
      method: 'GET',
      headers: { ...authHeaders(cfg), 'X-Request-ID': randomUUID() },
      signal: controller.signal,
    });
    let data: unknown = null;
    try {
      data = await http.json();
    } catch {
      data = null;
    }
    throwForStatus(http.status, '/v1/capabilities', data);
    const raw = (data ?? {}) as Record<string, unknown>;
    const capabilities: NeedleRemoteCapabilities = {
      model: typeof raw['model'] === 'string' ? raw['model'] : null,
      generation: typeof raw['generation'] === 'number' ? raw['generation'] : null,
      packageVersion:
        typeof raw['package_version'] === 'string' ? raw['package_version'] : null,
      toolCalling: raw['tool_calling'] === true,
      streaming: raw['streaming'] === true,
      queueDepth: typeof raw['queue_depth'] === 'number' ? raw['queue_depth'] : null,
      uptimeS: typeof raw['uptime_s'] === 'number' ? raw['uptime_s'] : null,
      initialized: typeof raw['initialized'] === 'boolean' ? raw['initialized'] : null,
    };
    return { capabilities, latencyMs: Date.now() - started };
  } catch (err) {
    if (err instanceof NeedleClientError) throw err;
    throw mapNetworkError(err, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

export interface StreamTurnEvent {
  type: 'started' | 'result' | 'done';
  requestId?: string;
  turn?: NeedleTurnResult;
  latencyMs?: number;
}

/**
 * Streaming turn: POST {base}/v1/complete/stream (SSE). The engine returns a
 * single turn dict, so the stream carries framing (`started` immediately for
 * TTFB, then `result`, then `done`) rather than partial tokens. Falls back
 * to unary completeTurn when the server has no stream endpoint (404).
 */
export async function completeTurnStream(
  opts: CompleteTurnOptions & {
    signal?: AbortSignal;
    onEvent?: (event: StreamTurnEvent) => void;
  },
): Promise<{ turn: NeedleTurnResult; latencyMs: number; streamed: boolean }> {
  const cfg = opts.config ?? (await resolveNeedleConfig());
  requireUsable(cfg);
  if (typeof opts.query !== 'string' || opts.query.trim() === '') {
    throw new NeedleClientError('INVALID', 'query must be a non-empty string.');
  }
  const body: Record<string, unknown> = {
    query: opts.query,
    ...(opts.system !== undefined && opts.system !== '' ? { system: opts.system } : {}),
    tools: opts.tools,
    max_new_tokens:
      opts.maxNewTokens !== undefined ? clampMaxTokens(opts.maxNewTokens) : cfg.maxNewTokens,
  };
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  (timer as NodeJS.Timeout).unref?.();
  const forwardAbort = (): void => controller.abort();
  opts.signal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const res = await fetch(`${cfg.url}/v1/complete/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...authHeaders(cfg),
        'X-Request-ID': randomUUID(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.status === 404) {
      const fallback = await completeTurn(opts);
      return { turn: fallback.turn, latencyMs: fallback.latencyMs, streamed: false };
    }
    let data: unknown = null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      throwForStatus(res.status, '/v1/complete/stream', data);
      return { turn: parseTurnResult(data), latencyMs: Date.now() - started, streamed: false };
    }
    throwForStatus(res.status, '/v1/complete/stream', null);
    const text = await res.text();
    let turn: NeedleTurnResult | null = null;
    let serverLatency: number | null = null;
    for (const chunk of text.split('\n\n')) {
      const lines = chunk.split('\n');
      let event = '';
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (event === '' && dataLines.length === 0) continue;
      let payload: Record<string, unknown> = {};
      try {
        const joined = dataLines.join('\n');
        if (joined !== '') payload = JSON.parse(joined) as Record<string, unknown>;
      } catch {
        throw new NeedleClientError('MALFORMED', 'Needle 3 stream sent malformed JSON.');
      }
      if (event === 'started') {
        const requestId = typeof payload['request_id'] === 'string' ? payload['request_id'] : undefined;
        opts.onEvent?.(
          requestId !== undefined ? { type: 'started', requestId } : { type: 'started' },
        );
      } else if (event === 'result') {
        const rawResult: unknown = payload['result'];
        turn = parseTurnResult(rawResult);
        const latencyRaw: unknown = payload['latency_ms'];
        serverLatency =
          typeof latencyRaw === 'number' && Number.isFinite(latencyRaw) ? latencyRaw : null;
        opts.onEvent?.({
          type: 'result',
          ...(turn !== null ? { turn } : {}),
          ...(serverLatency !== null ? { latencyMs: serverLatency } : {}),
        });
      } else if (event === 'done') {
        opts.onEvent?.({ type: 'done' });
      } else if (event === 'error') {
        const message =
          typeof payload['error'] === 'string' ? payload['error'] : 'stream failed';
        throw new NeedleClientError('NEEDLE_ERROR', `Needle 3 stream error: ${message}`);
      }
    }
    if (turn === null) {
      throw new NeedleClientError('MALFORMED', 'Needle 3 stream ended without a result.');
    }
    return { turn, latencyMs: serverLatency ?? Date.now() - started, streamed: true };
  } catch (err) {
    if (err instanceof NeedleClientError) throw err;
    throw mapNetworkError(err, cfg.timeoutMs);
  } finally {
    opts.signal?.removeEventListener('abort', forwardAbort);
    clearTimeout(timer);
  }
}
