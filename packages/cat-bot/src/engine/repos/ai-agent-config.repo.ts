import {
  getAiAgentConfigStore as _getStore,
  saveAiAgentConfigStore as _saveStore,
  clearAiAgentConfigStore as _clearStore,
} from 'database';
import type { AiAgentConfigStoreValue } from 'database';
import { encrypt, decrypt } from '@/engine/utils/crypto.util.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

/**
 * AI Agent Config Repo — LRU-cached deployment-level Cactus Needle 3
 * connection settings.
 *
 * Resolution order: database store (set via Admin → AI Agent dashboard)
 * wins; environment variables (NEEDLE_*) are the fallback so fresh deploys
 * work before first dashboard save. The Needle Bearer token is encrypted
 * at rest (AES-256-GCM, enc:v1:) — the database layer only ever sees
 * ciphertext, and the API layer only ever returns `tokenConfigured`.
 *
 * Storage lives in the 'database' package (system_settings row /
 * systemSettings doc), persisted per-adapter. Fail-open on DB errors so a
 * storage hiccup never crashes the bot or the AI pipeline.
 */

const CACHE_KEY = 'ai-agent:config:stored';

export interface AiAgentSettings {
  enabled: boolean;
  needleUrl: string;
  /** Decrypted API key. Empty when none configured. Never log this. */
  token: string;
  tokenConfigured: boolean;
  timeoutMs: number;
  /** Per-request inference budget forwarded as max_new_tokens (1–512). */
  maxNewTokens: number;
  confidenceThreshold: number;
  updatedAt: string;
  fromStore: boolean;
}

function envSettings(): AiAgentSettings {
  const timeoutRaw = parseInt(process.env['NEEDLE_TIMEOUT_MS'] ?? '', 10);
  const tokensRaw = parseInt(process.env['NEEDLE_MAX_NEW_TOKENS'] ?? '', 10);
  const confRaw = parseFloat(process.env['NEEDLE_CONFIDENCE_THRESHOLD'] ?? '');
  // Canonical NEEDLE_API_KEY first; legacy NEEDLE_AUTH_TOKEN is a fallback.
  const token = (
    process.env['NEEDLE_API_KEY'] ??
    process.env['NEEDLE_AUTH_TOKEN'] ??
    ''
  ).trim();
  return {
    enabled: process.env['NEEDLE_ENABLED'] === 'true',
    needleUrl: (process.env['NEEDLE_URL'] ?? '').trim(),
    token,
    tokenConfigured: token !== '',
    // Render Free cold starts need room, but requests stay bounded (1–120 s).
    timeoutMs:
      Number.isFinite(timeoutRaw) && timeoutRaw > 0
        ? Math.min(120000, Math.max(1000, Math.round(timeoutRaw)))
        : 30000,
    maxNewTokens:
      Number.isFinite(tokensRaw)
        ? Math.min(512, Math.max(1, Math.round(tokensRaw)))
        : 256,
    confidenceThreshold:
      Number.isFinite(confRaw) && confRaw >= 0 && confRaw <= 1 ? confRaw : 0.7,
    updatedAt: '',
    fromStore: false,
  };
}

/** Reads effective settings (store → env fallback). Never throws. */
export async function getAiAgentSettings(): Promise<AiAgentSettings> {
  const cached = lruCache.get<AiAgentSettings>(CACHE_KEY);
  if (cached !== undefined) return cached;
  let settings: AiAgentSettings;
  try {
    const store = (await _getStore()) as AiAgentConfigStoreValue | null;
    if (!store) {
      settings = envSettings();
    } else {
      let token = '';
      if (store.encryptedToken) {
        try {
          token = decrypt(store.encryptedToken);
        } catch {
          token = '';
        }
      }
      settings = {
        enabled: store.enabled,
        needleUrl: store.needleUrl,
        token,
        tokenConfigured: store.encryptedToken !== '',
        timeoutMs: store.timeoutMs,
        maxNewTokens:
          typeof store.maxNewTokens === 'number' &&
          Number.isFinite(store.maxNewTokens)
            ? Math.min(512, Math.max(1, Math.round(store.maxNewTokens)))
            : 256,
        confidenceThreshold: store.confidenceThreshold,
        updatedAt: store.updatedAt,
        fromStore: true,
      };
    }
  } catch {
    settings = envSettings();
  }
  lruCache.set(CACHE_KEY, settings);
  return settings;
}

export interface SaveAiAgentSettingsInput {
  enabled: boolean;
  needleUrl: string;
  /** Plaintext API key from the dashboard (undefined = keep existing). */
  token?: string | undefined;
  timeoutMs: number;
  maxNewTokens: number;
  confidenceThreshold: number;
}

/** Persists dashboard settings (API key encrypted). Writes through the cache. */
export async function saveAiAgentSettings(
  input: SaveAiAgentSettingsInput,
): Promise<AiAgentSettings> {
  const prev = await getAiAgentSettings();
  const token = input.token !== undefined ? input.token : prev.token;
  const value: AiAgentConfigStoreValue = {
    enabled: input.enabled,
    needleUrl: input.needleUrl,
    encryptedToken: token ? encrypt(token) : '',
    timeoutMs: input.timeoutMs,
    maxNewTokens: Math.min(512, Math.max(1, Math.round(input.maxNewTokens))),
    confidenceThreshold: input.confidenceThreshold,
    updatedAt: new Date().toISOString(),
  };
  await _saveStore(value);
  const settings: AiAgentSettings = {
    enabled: value.enabled,
    needleUrl: value.needleUrl,
    token,
    tokenConfigured: value.encryptedToken !== '',
    timeoutMs: value.timeoutMs,
    maxNewTokens: value.maxNewTokens,
    confidenceThreshold: value.confidenceThreshold,
    updatedAt: value.updatedAt,
    fromStore: true,
  };
  lruCache.set(CACHE_KEY, settings);
  return settings;
}

/** Clears the dashboard store (falls back to env). */
export async function clearAiAgentSettings(): Promise<void> {
  await _clearStore();
  lruCache.del(CACHE_KEY);
}

/** Last successful Needle request timestamp (in-memory, for the dashboard). */
let lastSuccessAt = '';
export function recordAiAgentSuccess(): void {
  lastSuccessAt = new Date().toISOString();
}
export function getAiAgentLastSuccess(): string {
  return lastSuccessAt;
}
