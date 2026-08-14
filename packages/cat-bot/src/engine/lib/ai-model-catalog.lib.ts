/**
 * Live AI Model Catalog — fetches the FULL model list from each provider's
 * OpenAI-compatible /models endpoint so the dashboard can offer every model
 * (including all free ones), not just a curated subset.
 *
 * Caching: model lists change rarely (weekly at most), so each successful fetch
 * is cached for 6 hours. OpenRouter (the PRIMARY provider) has a public list,
 * so it's cached globally; Groq's list can differ per API key (free vs paid
 * tier), so it's cached per user. Failures are NOT cached — the caller falls
 * back to the static catalog and retries on the next request.
 *
 * Fail-open: any network/parse error returns null (caller decides the
 * fallback) and logs a warning — a models outage must never break the
 * dashboard or the AI agent.
 */
import axios from 'axios';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';
import {
  AI_PROVIDERS,
  type AiProviderId,
  type AiProviderModel,
} from '@/engine/repos/ai-provider.constants.js';

const MODELS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MODELS_FETCH_TIMEOUT_MS = 10_000;

const OPENROUTER_CACHE_KEY = 'ai:models:openrouter';
const groqCacheKey = (userId: string): string => `ai:models:groq:${userId}`;

// ── API response shapes ──────────────────────────────────────────────────────

interface GroqModelsResponse {
  data?: Array<{ id?: string }> | null;
}

interface OpenRouterModelEntry {
  id?: string;
  name?: string | null;
  pricing?: {
    prompt?: string | number | null;
    completion?: string | number | null;
  } | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Free = `:free` variant id, or zero cost for both prompt and completion. */
function isFreeModel(id: string, entry: OpenRouterModelEntry): boolean {
  if (/:free$/i.test(id)) return true;
  const p = entry.pricing?.prompt;
  const c = entry.pricing?.completion;
  return (
    p !== undefined && p !== null && Number(p) === 0 &&
    c !== undefined && c !== null && Number(c) === 0
  );
}

/**
 * Turns a raw model id into a readable label for providers that don't ship a
 * display name (Groq). "openai/gpt-oss-120b" → "GPT-OSS 120B (OpenAI)",
 * "llama-3.3-70b-versatile" → "Llama 3.3 70B Versatile",
 * "openai/gpt-4o:free" → "GPT-4o (OpenAI) — free".
 */
export function formatModelLabel(id: string): string {
  const [path, suffix] = id.split(':');
  const basePath = path ?? id;
  const segments = basePath.split('/');
  const rawName = segments[segments.length - 1] ?? basePath;
  const org = segments.length > 1 ? segments.slice(0, -1).join('/') : null;
  const pretty = rawName
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => {
      if (/^\d+b$/i.test(word)) return word.toUpperCase(); // 70b → 70B
      if (/^(gpt|oss|llm|ai|api|sdxl)$/i.test(word)) {
        return word.toUpperCase(); // known acronyms
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
  const base = org ? `${pretty} (${org})` : pretty;
  return suffix ? `${base} — free` : base;
}

/** Free models first (alphabetical), then the rest (alphabetical). */
function sortModels(models: AiProviderModel[]): AiProviderModel[] {
  return [...models].sort((a, b) => {
    if (a.free !== b.free) return a.free ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

// ── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchOpenRouterModels(): Promise<AiProviderModel[] | null> {
  const { data } = await axios.get<{ data?: OpenRouterModelEntry[] | null }>(
    AI_PROVIDERS.openrouter.modelsUrl,
    { timeout: MODELS_FETCH_TIMEOUT_MS },
  );
  const entries = data?.data;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const models: AiProviderModel[] = [];
  for (const e of entries) {
    if (typeof e.id !== 'string' || e.id.length === 0) continue;
    models.push({
      id: e.id,
      label: (e.name && e.name.trim()) || formatModelLabel(e.id),
      free: isFreeModel(e.id, e),
    });
  }
  return models.length > 0 ? sortModels(models) : null;
}

async function fetchGroqModels(apiKey: string): Promise<AiProviderModel[] | null> {
  const { data } = await axios.get<GroqModelsResponse>(
    AI_PROVIDERS.groq.modelsUrl,
    {
      timeout: MODELS_FETCH_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );
  const entries = data?.data;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const models: AiProviderModel[] = [];
  for (const e of entries) {
    if (typeof e.id !== 'string' || e.id.length === 0) continue;
    models.push({ id: e.id, label: formatModelLabel(e.id) });
  }
  return models.length > 0 ? sortModels(models) : null;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the live model catalog for a provider, or null when the fetch failed
 * (callers fall back to the static catalog). Results are cached for 6h.
 *
 * @param apiKey  Required for groq (the endpoint authenticates per key); unused
 *                for openrouter (public endpoint).
 * @param cacheKey User id for groq — the catalog is cached per user because
 *                Groq's model list can differ between keys.
 */
export async function getProviderModelsCached(
  provider: AiProviderId,
  apiKey?: string | null,
  cacheKey?: string,
): Promise<AiProviderModel[] | null> {
  const key =
    provider === 'openrouter'
      ? OPENROUTER_CACHE_KEY
      : groqCacheKey(cacheKey || 'default');

  const cached = lruCache.get<AiProviderModel[]>(key);
  if (cached !== undefined) return cached;

  try {
    const models =
      provider === 'openrouter'
        ? await fetchOpenRouterModels()
        : await fetchGroqModels(apiKey ?? '');
    if (models) lruCache.set(key, models, MODELS_CACHE_TTL_MS);
    return models;
  } catch (err) {
    // Fail-open — never cache a failure; the caller uses the fallback catalog
    // and a later request will retry.
    console.warn(
      `[ai-model-catalog] Failed to fetch ${provider} models:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
