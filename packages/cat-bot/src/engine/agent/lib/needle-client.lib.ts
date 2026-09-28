import { getAiAgentSettings } from '@/engine/repos/ai-agent-config.repo.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import type { NeedleToolDefinition } from './tool-schema.lib.js';

/**
 * Needle 3 client — Persian-Bot → hosted Cactus Needle 3 (playground-style).
 *
 * Live contract (verified against https://lanceajiro-needle.onrender.com):
 *   GET  /model                 → {"name": "needle3.cact"}
 *   POST /complete {query, tools} → Needle turn dict
 *     {type, success, error, error_code, reason, function_calls: [{name,
 *      arguments: {...}}], suppressed_calls, reasoning, confidence,
 *      validation, prefill_tps, decode_tps, peak_ram_mb}
 *   POST /reset                 → {"ok": true}
 *
 * No /health, no /capabilities, no auth on inference. The stored base URL is
 * NEVER suffixed at rest — this client appends /model, /complete, /reset so
 * one URL serves every endpoint. An optional deployment-level Service Token
 * is sent as `Authorization: Bearer` when configured (harmless when the
 * service is unauthenticated). A Cactus Platform API key is NEVER required
 * for inference and is NEVER sent.
 *
 * Multi-turn: the hosted playground keeps ONE global agent (shared
 * conversation slot, reset when the toolset changes or /reset is called).
 * Remote session persistence therefore cannot be assumed — agent.ts drives
 * the loop with a locally-held transcript (full context in every query) and
 * calls /reset at the start/end of each AI sequence. Concurrent AI users
 * share the remote slot; this is safe because tool execution, guard checks
 * and delivery all happen locally per-turn and every tool name is
 * re-validated against the caller's own catalogue.
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
  /** Normalized base URL (no trailing slash, no /complete suffix). */
  url: string;
  token: string;
  timeoutMs: number;
  confidenceThreshold: number;
  tokenConfigured: boolean;
  authMode: NeedleAuthMode;
}

export const DEFAULT_TIMEOUT_MS = 300000;
export const MAX_TIMEOUT_MS = 600000;
const MODEL_PROBE_TIMEOUT_MS = 30000;
const CAPABILITY_CACHE_TTL_MS = 5 * 60 * 1000;

/** Normalizes the stored base URL. Never appends an endpoint path. */
export function normalizeBaseUrl(raw: string): string {
  return (raw ?? '').trim().replace(/\/+$/, '');
}

/** Resolves effective config: DB store (dashboard) wins, env is the fallback. */
export async function resolveNeedleConfig(): Promise<NeedleConfig> {
  const envEnabled = process.env['NEEDLE_ENABLED'] === 'true';
  const envUrl = normalizeBaseUrl(process.env['NEEDLE_URL'] ?? '');
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

  const url = normalizeBaseUrl(store?.needleUrl ?? envUrl);
  const token = (store?.token ?? envToken).trim();
  return {
    enabled: store ? store.enabled : envEnabled,
    url,
    token,
    timeoutMs:
      store?.timeoutMs ??
      (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS),
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

function authHeaders(cfg: NeedleConfig): Record<string, string> {
  // Service Token only — never a Cactus Platform API key, never on principle
  // when unconfigured. Unauthenticated services simply ignore the header.
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
      'Needle 3 rejected authentication (check the Service Token).',
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
  path: '/complete' | '/model' | '/reset';
  method: 'GET' | 'POST';
  body?: Record<string, unknown>;
  timeoutMs: number;
  /** Single retry on transient failures only (never 401/4xx). */
  retryTransient?: boolean;
}): Promise<RawResponse> {
  const started = Date.now();
  const url = `${opts.cfg.url}${opts.path}`;
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
    // inference is usually still processing server-side (single global
    // slot), so retrying just queues another slow run behind it.
    const retryable =
      err instanceof NeedleClientError && err.code === 'SERVICE_UNAVAILABLE';
    if (opts.retryTransient !== false && retryable) {
      return attempt();
    }
    throw err;
  }
}

/** One Needle inference turn: POST {base}/complete {query, tools}. */
export async function completeTurn(opts: {
  query: string;
  tools: NeedleToolDefinition[];
  config?: NeedleConfig;
}): Promise<{ turn: NeedleTurnResult; latencyMs: number }> {
  const cfg = opts.config ?? (await resolveNeedleConfig());
  requireUsable(cfg);
  const res = await requestJson({
    cfg,
    path: '/complete',
    method: 'POST',
    body: { query: opts.query, tools: opts.tools },
    timeoutMs: cfg.timeoutMs,
  });
  const result =
    res.data && typeof res.data === 'object'
      ? (res.data as Record<string, unknown>)
      : null;
  return { turn: parseTurnResult(result), latencyMs: res.latencyMs };
}

/** Fast model probe: GET {base}/model → loaded model name. */
export async function fetchModelName(config?: NeedleConfig): Promise<string | null> {
  const cfg = config ?? (await resolveNeedleConfig());
  requireUsable(cfg);
  const res = await requestJson({
    cfg,
    path: '/model',
    method: 'GET',
    timeoutMs: Math.min(cfg.timeoutMs, MODEL_PROBE_TIMEOUT_MS),
    retryTransient: false,
  });
  const data = (res.data ?? {}) as Record<string, unknown>;
  const name = data['name'];
  const model = typeof name === 'string' && name !== '' ? name : null;
  logProbe({
    baseUrl: cfg.url,
    path: '/model',
    status: res.status,
    durationMs: res.latencyMs,
    ...(model ? { model } : {}),
  });
  return model;
}

/** Clears the hosted service's shared conversation slot (best-effort). */
export async function resetRemote(config?: NeedleConfig): Promise<void> {
  const cfg = config ?? (await resolveNeedleConfig());
  try {
    requireUsable(cfg);
  } catch {
    return;
  }
  try {
    await requestJson({
      cfg,
      path: '/reset',
      method: 'POST',
      body: {},
      timeoutMs: Math.min(cfg.timeoutMs, 15000),
      retryTransient: false,
    });
  } catch {
    /* best-effort — a stale remote slot only confuses, never breaches */
  }
}

export interface NeedleCapabilities {
  toolCalling: boolean;
  mcp: boolean;
  skills: boolean;
  mcpReason?: string;
  skillsReason?: string;
  /** Loaded model name from GET /model (only what the service returns). */
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

/**
 * Real connection probe: GET /model (fast reachability + model name) then
 * POST /complete with an empty toolset (real inference proof). Only a
 * successful /complete yields Connected. Results are cached 5 minutes for
 * page loads; Test Connection bypasses the cache.
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

  let model: string | null;
  try {
    model = await fetchModelName(cfg);
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

  try {
    const res = await requestJson({
      cfg,
      path: '/complete',
      method: 'POST',
      body: { query: 'connection check', tools: [] },
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
      endpoint: '/complete',
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