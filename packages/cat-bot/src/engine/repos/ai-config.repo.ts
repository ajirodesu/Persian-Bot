/**
 * AI Config Repo — per-dashboard-user AI settings backed by the
 * `bot_user_ai_config` table, with a short-TTL in-memory cache.
 *
 * Provider API keys are encrypted at rest (AES-256-GCM via crypto.util).
 * Providers with dedicated table columns use them; every other provider plus
 * base URLs and tuning lives in the `agent_settings` JSON blob (keys inside
 * the blob are individually encrypted).
 */

import {
  getUserAiConfig as _getUserAiConfig,
  saveUserAiConfig as _saveUserAiConfig,
  deleteUserAiConfig as _deleteUserAiConfig,
} from 'database';
import { encrypt, decrypt } from '@/engine/utils/crypto.util.js';
import type { PersistedAiConfig } from '@/engine/ai/config.js';

/** Providers with dedicated encrypted-key/model columns. */
const COLUMN_PROVIDERS = [
  'openrouter',
  'groq',
  'nvidia',
  'openai',
  'gemini',
  'zen',
  'orcarouter',
  'fastrouter',
  'huggingface',
  'tokenrouter',
] as const;

function maskKey(key?: string): string | null {
  if (!key) return null;
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 3)}••••••${key.slice(-2)}`;
}

function safeDecrypt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    return decrypt(value);
  } catch {
    return undefined;
  }
}

function parseBlob(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

// ── TTL cache ────────────────────────────────────────────────────────────────
// Dashboard saves are rare; chat turns are hot. A 60s TTL keeps the hot path
// off the DB while converging quickly after a dashboard save (which also
// invalidates explicitly).

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: PersistedAiConfig }>();

export function clearAiConfigCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

/** Read the user's stored settings. Never throws — returns {} when absent. */
export async function loadUserAiSettings(userId: string): Promise<PersistedAiConfig> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const out: PersistedAiConfig = {};
  try {
    const row = await _getUserAiConfig(userId);
    if (!row) {
      cache.set(userId, { at: Date.now(), value: out });
      return out;
    }

    const providers: NonNullable<PersistedAiConfig['providers']> = {};
    for (const p of COLUMN_PROVIDERS) {
      const key = safeDecrypt(row[`${p}_encrypted_key`]);
      const model = row[`${p}_model`];
      if (key || typeof model === 'string') {
        providers[p] = {
          ...(key ? { apiKey: key } : {}),
          ...(typeof model === 'string' && model ? { models: [model] } : {}),
        };
      }
    }

    const blob = parseBlob(row['agent_settings']);
    const extra = parseBlob(blob.extraProviders);
    for (const [p, v] of Object.entries(extra)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const e = v as Record<string, unknown>;
      const key = safeDecrypt(e.apiKey);
      providers[p] = {
        ...(key ? { apiKey: key } : {}),
        ...(typeof e.baseUrl === 'string' && e.baseUrl ? { baseUrl: e.baseUrl } : {}),
        ...(Array.isArray(e.models)
          ? { models: e.models.filter((m): m is string => typeof m === 'string') }
          : {}),
      };
    }

    if (Object.keys(providers).length > 0) out.providers = providers;
    if (typeof row['provider'] === 'string' && row['provider']) {
      out.provider = row['provider'];
    }
    for (const k of [
      'enabled',
      'model',
      'models',
      'baseUrl',
      'temperature',
      'maxTokens',
      'timeout',
      'maxRetries',
      'agents',
      'memory',
      'execution',
      'moderation',
      'autoReply',
    ] as const) {
      if (blob[k] !== undefined) {
        (out as Record<string, unknown>)[k] = blob[k];
      }
    }
    // A dashboard-saved global apiKey (for provider/model aliases) is kept
    // encrypted inside the blob.
    const savedKey = safeDecrypt(blob.apiKey);
    if (savedKey) out.apiKey = savedKey;
  } catch {
    return hit?.value ?? out;
  }

  cache.set(userId, { at: Date.now(), value: out });
  return out;
}

/**
 * Merge a patch over the stored settings and persist. Keys are encrypted;
 * `apiKey: ''` (or absent) keeps the stored secret. Returns the merged view.
 */
export async function saveUserAiSettings(
  userId: string,
  patch: PersistedAiConfig,
): Promise<PersistedAiConfig> {
  const current = await loadUserAiSettings(userId);
  // Deep-merge providers so a patch without an apiKey keeps the stored secret
  // in both the cache and the row (empty keys never overwrite).
  const mergedProviders: NonNullable<PersistedAiConfig['providers']> = {
    ...(current.providers ?? {}),
  };
  for (const [p, v] of Object.entries(patch.providers ?? {})) {
    const next = { ...(mergedProviders[p] ?? {}), ...(v ?? {}) };
    if (!v?.apiKey) {
      const stored = current.providers?.[p]?.apiKey;
      if (stored) next.apiKey = stored;
      else delete next.apiKey;
    }
    mergedProviders[p] = next;
  }
  const merged: PersistedAiConfig = { ...current, ...patch, providers: mergedProviders };

  const cols: Record<string, unknown> = {};
  if (patch.provider !== undefined) cols.provider = patch.provider;

  const providers = merged.providers ?? {};
  const extraProviders: Record<string, unknown> = {};
  for (const [p, v] of Object.entries(providers)) {
    if (!v) continue;
    if ((COLUMN_PROVIDERS as readonly string[]).includes(p)) {
      if (v.apiKey) {
        cols[`${p}_encrypted_key`] = encrypt(v.apiKey);
        cols[`${p}_key_hint`] = maskKey(v.apiKey);
      }
      if (v.models?.length) cols[`${p}_model`] = v.models[0];
    } else if (v.apiKey || v.baseUrl || v.models?.length) {
      extraProviders[p] = {
        ...(v.apiKey ? { apiKey: encrypt(v.apiKey) } : {}),
        ...(v.baseUrl ? { baseUrl: v.baseUrl } : {}),
        ...(v.models?.length ? { models: v.models } : {}),
      };
    }
  }

  const blob: Record<string, unknown> = {};
  for (const k of [
    'enabled',
    'model',
    'models',
    'baseUrl',
    'temperature',
    'maxTokens',
    'timeout',
    'maxRetries',
    'agents',
    'memory',
    'execution',
    'moderation',
    'autoReply',
  ] as const) {
    const value = (merged as Record<string, unknown>)[k];
    if (value !== undefined) blob[k] = value;
  }
  if (Object.keys(extraProviders).length > 0) blob.extraProviders = extraProviders;
  if (merged.apiKey) blob.apiKey = encrypt(merged.apiKey);
  cols.agent_settings = JSON.stringify(blob);

  try {
    await _saveUserAiConfig(userId, cols);
  } catch {
    // Keep the in-memory view converging even if the write failed; the next
    // load will retry from the DB.
  }
  cache.set(userId, { at: Date.now(), value: merged });
  return merged;
}

export async function deleteUserAiSettings(userId: string): Promise<void> {
  cache.delete(userId);
  try {
    await _deleteUserAiConfig(userId);
  } catch {
    /* best-effort */
  }
}
