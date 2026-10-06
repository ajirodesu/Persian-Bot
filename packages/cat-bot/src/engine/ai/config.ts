/**
 * AI configuration — layered resolution with env defaults, per-user database
 * settings, and per-agent inheritance.
 *
 * Precedence (increasing):
 *   built-in defaults < AI_* env vars < user's DB settings
 *     < ai.agents.default < ai.agents.<name> < per-call overrides
 *
 * All operator state lives in the `bot_user_ai_config` table (see
 * engine/repos/ai-config.repo.ts). This module keeps a short-lived in-memory
 * snapshot per dashboard user so the hot chat path never blocks on the DB;
 * the repo owns a 60s TTL cache underneath and dashboard saves invalidate
 * explicitly. Secrets are never logged and never leave the server unmasked.
 */

import { createProvider } from './provider/index.js';
import type { Provider } from './provider/index.js';
import { loadUserAiSettings, saveUserAiSettings } from '@/engine/repos/ai-config.repo.js';
import type { AgentConfig, ModelRef } from './agent-types.js';

/** Order used when no agent names a provider. */
export const PROVIDER_PRIORITY = ['groq', 'deepinfra', 'openrouter', 'venice', 'openai'] as const;

/** Local runtimes authenticate with a placeholder — "no key" is not an error. */
export const KEYLESS_PROVIDERS = new Set(['ollama', 'lmstudio']);

export const BUILTIN_DEFAULTS: Required<
  Pick<AgentConfig, 'temperature' | 'maxTokens' | 'json' | 'timeout'>
> = {
  temperature: 0.3,
  maxTokens: 1024,
  json: false,
  timeout: 30_000,
};

export interface PersistedAiConfig {
  enabled?: boolean;
  provider?: string;
  model?: string;
  models?: string[];
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  maxRetries?: number;
  providers?: Record<string, { apiKey?: string; baseUrl?: string; models?: string[] }>;
  agents?: Record<string, AgentConfig>;
  memory?: {
    enabled?: boolean;
    maxRecentTurns?: number;
    summaryMaxChars?: number;
    retentionDays?: number;
  };
  execution?: {
    maxSteps?: number;
    timeoutMs?: number;
    maxToolErrors?: number;
    maxCallsPerStep?: number;
  };
  moderation?: {
    enabled?: boolean;
    minConfidence?: number;
    secondOpinion?: boolean;
    dryRun?: boolean;
  };
  autoReply?: {
    /** Reply when the bot's nickname is mentioned (default true). */
    mention?: boolean;
    /** Reply to every DM (default true). */
    dm?: boolean;
  };
}

// ── Snapshots ────────────────────────────────────────────────────────────────
// 'global' holds the env-only view for contexts without a dashboard user
// (tests, CLI, boot). Per-user snapshots load from the DB on demand.

const snapshots = new Map<string, PersistedAiConfig>([['global', {}]]);

function snap(userId?: string): PersistedAiConfig {
  if (userId && snapshots.has(userId)) return snapshots.get(userId)!;
  return snapshots.get('global')!;
}

/** Sync read of the cached snapshot (DB load happens via ensure...). */
export function getPersistedAiConfig(userId?: string): PersistedAiConfig {
  return snap(userId);
}

/** Load (or reload) the user's DB settings into the snapshot. Never throws. */
export async function ensureUserAiSnapshot(userId: string): Promise<PersistedAiConfig> {
  try {
    const settings = await loadUserAiSettings(userId);
    snapshots.set(userId, settings);
    return settings;
  } catch {
    if (!snapshots.has(userId)) snapshots.set(userId, {});
    return snapshots.get(userId)!;
  }
}

/** Persist the user's patch to the DB and refresh the snapshot + providers. */
export async function saveUserAiSnapshot(
  userId: string,
  patch: PersistedAiConfig,
): Promise<PersistedAiConfig> {
  const merged = await saveUserAiSettings(userId, patch);
  snapshots.set(userId, merged);
  resetProviderCache();
  return merged;
}

/** Test seam — seed a snapshot without touching the DB. */
export function setSnapshotForTests(userId: string, value: PersistedAiConfig): void {
  snapshots.set(userId, value);
}

/** Test seam — drop all snapshots back to env-only. */
export function clearSnapshotsForTests(): void {
  snapshots.clear();
  snapshots.set('global', {});
}

function envProviders(): Record<string, { apiKey?: string; baseUrl?: string; models?: string[] }> {
  const single = (prefix: string): { apiKey?: string; baseUrl?: string; models?: string[] } => {
    const apiKey = process.env[`${prefix}_API_KEY`];
    const baseUrl = process.env[`${prefix}_BASE_URL`];
    const models = process.env[`${prefix}_MODELS`]
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const out: { apiKey?: string; baseUrl?: string; models?: string[] } = {};
    if (apiKey) out.apiKey = apiKey;
    if (baseUrl) out.baseUrl = baseUrl;
    if (models?.length) out.models = models;
    return out;
  };

  return {
    groq: single('GROQ'),
    openrouter: single('OPENROUTER'),
    deepinfra: single('DEEPINFRA'),
    venice: single('VENICE'),
    openai: single('OPENAI'),
    together: single('TOGETHER'),
    fireworks: single('FIREWORKS'),
    lepton: single('LEPTON'),
    ollama: single('OLLAMA'),
    lmstudio: single('LMSTUDIO'),
  };
}

/** Effective provider map: env vars under the user's DB settings. */
export function effectiveProviders(
  userId?: string,
): Record<string, { apiKey?: string; baseUrl?: string; models?: string[] }> {
  const cfg = snap(userId);
  const env = envProviders();
  const names = new Set([...Object.keys(env), ...Object.keys(cfg.providers ?? {})]);
  const out: Record<string, { apiKey?: string; baseUrl?: string; models?: string[] }> = {};
  for (const name of names) {
    const merged = { ...(env[name] ?? {}), ...(cfg.providers?.[name] ?? {}) };
    if (Object.keys(merged).length > 0) out[name] = merged;
  }
  if (process.env.AI_PROVIDER && process.env.AI_API_KEY) {
    const p = process.env.AI_PROVIDER.toLowerCase();
    out[p] = {
      apiKey: process.env.AI_API_KEY,
      ...(process.env.AI_BASE_URL ? { baseUrl: process.env.AI_BASE_URL } : {}),
      ...(process.env.AI_MODEL ? { models: [process.env.AI_MODEL] } : {}),
      ...(out[p] ?? {}),
    };
  }
  if (cfg.provider) {
    const p = cfg.provider.toLowerCase();
    out[p] = {
      ...(out[p] ?? {}),
      ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
      ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
      ...(cfg.model ? { models: [cfg.model] } : {}),
      ...(cfg.models?.length ? { models: cfg.models } : {}),
    };
  }
  return out;
}

/** Effective agent map: DB agents over the snapshot default agent. */
function effectiveAgents(userId?: string): Record<string, AgentConfig> {
  const cfg = snap(userId);
  const agents: Record<string, AgentConfig> = { ...(cfg.agents ?? {}) };
  if (!agents.default) {
    const def: AgentConfig = {};
    if (cfg.provider) def.provider = cfg.provider;
    if (cfg.models?.length) def.models = cfg.models;
    else if (cfg.model) def.model = cfg.model;
    if (cfg.temperature !== undefined) def.temperature = cfg.temperature;
    if (cfg.maxTokens !== undefined) def.maxTokens = cfg.maxTokens;
    if (cfg.timeout !== undefined) def.timeout = cfg.timeout;
    if (Object.keys(def).length > 0) agents.default = def;
  }
  return agents;
}

export function isAiEnabled(userId?: string): boolean {
  const cfg = snap(userId);
  if (cfg.enabled !== undefined) return cfg.enabled;
  return (process.env.AI_ENABLED ?? 'true').toLowerCase() !== 'false';
}

export function providerSettings(
  name: string,
  userId?: string,
): { apiKey?: string; baseUrl?: string; models?: string[] } {
  return effectiveProviders(userId)[name.toLowerCase()] ?? {};
}

export function hasKey(name: string, userId?: string): boolean {
  if (KEYLESS_PROVIDERS.has(name.toLowerCase())) return true;
  return Boolean(providerSettings(name, userId).apiKey);
}

/**
 * Merge, in increasing precedence:
 *   built-in defaults < env/DB default < agents.default
 *   < agents[name] < per-call overrides
 */
export function resolveAgentConfig(
  name: string,
  overrides: Partial<AgentConfig> = {},
  userId?: string,
): AgentConfig {
  const agents = effectiveAgents(userId);
  const asConfig = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const fallbackDefaults = asConfig(agents.default);
  const own = asConfig(agents[name]);

  const envBase: Record<string, unknown> = {};
  if (process.env.AI_MODEL) envBase.model = process.env.AI_MODEL;
  if (process.env.AI_MAX_TOKENS && Number.isFinite(Number(process.env.AI_MAX_TOKENS))) {
    envBase.maxTokens = Number(process.env.AI_MAX_TOKENS);
  }
  if (process.env.AI_TEMPERATURE && Number.isFinite(Number(process.env.AI_TEMPERATURE))) {
    envBase.temperature = Number(process.env.AI_TEMPERATURE);
  }

  return {
    ...BUILTIN_DEFAULTS,
    ...envBase,
    ...fallbackDefaults,
    ...own,
    ...overrides,
  } as AgentConfig;
}

function firstConfiguredProvider(userId?: string): string | null {
  for (const p of PROVIDER_PRIORITY) {
    if (hasKey(p, userId)) return p;
  }
  const configured = Object.keys(effectiveProviders(userId)).filter((k) => hasKey(k, userId));
  return configured[0] ?? null;
}

/**
 * Expand an agent config into the ordered list of concrete provider+model
 * attempts: every model of the primary provider first, then each fallback.
 */
export function buildCandidates(cfg: AgentConfig, userId?: string): ModelRef[] {
  const out: ModelRef[] = [];

  const primary = cfg.provider ?? firstConfiguredProvider(userId) ?? undefined;
  const providers = effectiveProviders(userId);
  if (primary) {
    const models =
      (cfg.models?.length ? cfg.models : null) ??
      (cfg.model ? [cfg.model] : null) ??
      (providers[primary]?.models?.length ? providers[primary]!.models! : null) ??
      [];
    for (const model of models) {
      const ref: ModelRef = { provider: primary, model };
      const configuredBase = providers[primary]?.baseUrl;
      if (configuredBase) ref.baseUrl = configuredBase;
      out.push(ref);
    }
  }

  for (const fb of cfg.fallback ?? []) {
    if (!fb?.provider || !fb?.model) continue;
    out.push({
      provider: fb.provider,
      model: fb.model,
      ...(fb.baseUrl ? { baseUrl: fb.baseUrl } : {}),
    });
  }

  const seen = new Set<string>();
  return out.filter((ref) => {
    if (!hasKey(ref.provider, userId)) return false;
    const key = `${ref.provider}:${ref.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Provider instances ───────────────────────────────────────────────────────

const providerCache = new Map<string, Provider>();

export function getProvider(
  ref: ModelRef,
  timeout: number,
  retryRateLimit: boolean,
  userId?: string,
): Provider {
  const cfg = providerSettings(ref.provider, userId);
  const apiKey = cfg.apiKey ?? 'local';
  const baseUrl = ref.baseUrl ?? cfg.baseUrl;
  const cacheKey = `${userId ?? 'global'}|${ref.provider}|${apiKey}|${baseUrl ?? ''}|${timeout}|${retryRateLimit}`;

  const cached = providerCache.get(cacheKey);
  if (cached) return cached;

  const created = createProvider(ref.provider, {
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    timeout,
    retryRateLimit,
  });
  providerCache.set(cacheKey, created);
  return created;
}

/** Called when AI config changes so stale credentials are never reused. */
export function resetProviderCache(): void {
  providerCache.clear();
}

export function describeRouting(
  userId?: string,
): Record<string, { candidates: string[]; json: boolean; temperature: number }> {
  const agents = effectiveAgents(userId);
  const names = new Set<string>(['default', 'moderator', 'moderator2', 'policy', 'editor']);
  for (const k of Object.keys(agents)) {
    if (!k.startsWith('_')) names.add(k);
  }
  const out: Record<string, { candidates: string[]; json: boolean; temperature: number }> = {};
  for (const name of names) {
    const cfg = resolveAgentConfig(name, {}, userId);
    out[name] = {
      candidates: buildCandidates(cfg, userId).map((c) =>
        c.model.startsWith(`${c.provider}/`) ? c.model : `${c.provider}/${c.model}`,
      ),
      json: cfg.json === true,
      temperature: cfg.temperature ?? BUILTIN_DEFAULTS.temperature,
    };
  }
  return out;
}
