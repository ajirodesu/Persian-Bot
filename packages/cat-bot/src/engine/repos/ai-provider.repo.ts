import {
  getUserAiConfig as _getUserAiConfig,
  saveUserAiKey as _saveUserAiKey,
  updateUserAiModel as _updateUserAiModel,
  deleteUserAiKey as _deleteUserAiKey,
} from 'database';
import { encrypt, decrypt } from '@/engine/utils/crypto.util.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';
import { getProviderModelsCached } from '@/engine/lib/ai-model-catalog.lib.js';
import {
  AI_PROVIDERS,
  isAiProviderId,
  isValidAiProviderKey,
  detectAiProviderFromKey,
  getAiProviderKeyHint,
  type AiProviderId,
  type AiProviderModel,
} from '@/engine/repos/ai-provider.constants.js';

// ============================================================================
// Types
// ============================================================================

/** What the agent actually needs per invocation: the active provider, its
 * model, and the decrypted API key for that provider. */
export interface AiRuntimeConfig {
  provider: AiProviderId;
  model: string;
  apiKey: string;
}

export interface AiProviderKeyStatus {
  hasKey: boolean;
  keyHint: string | null;
}

/** Full dashboard payload — per-provider connection status, the active
 * provider + model, each provider's remembered model, and the model catalog. */
export interface AiSettingsStatus {
  provider: AiProviderId;
  model: string;
  groqModel: string;
  openrouterModel: string;
  providers: Record<AiProviderId, AiProviderKeyStatus>;
  models: Record<AiProviderId, AiProviderModel[]>;
}

/** Thrown for user-facing validation failures (maps to HTTP 400). */
export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiConfigError';
  }
}

export interface SaveAiConfigPayload {
  provider: AiProviderId;
  model?: string;
  apiKey?: string;
}

// ============================================================================
// Cache
// ============================================================================

// The resolved runtime config is needed on EVERY AI invocation (runAgent +
// ai.ts's gate) — caching it eliminates a DB round-trip from the pre-agent hot
// path. Keys change rarely and save/remove invalidate explicitly, so the 15-min
// TTL is only a fallback.
const aiConfigCacheKey = (userId: string): string => `ai:cfg:${userId}`;

// ============================================================================
// Model-list helpers
// ============================================================================

interface ResolvedModelList {
  models: AiProviderModel[];
  /** True when the list came from a live fetch (vs the static fallback). */
  live: boolean;
}

/** Live catalog for a provider (cached 6h), falling back to the static list. */
async function resolveModelList(
  provider: AiProviderId,
  apiKey?: string | null,
  cacheKey?: string,
): Promise<ResolvedModelList> {
  const live = await getProviderModelsCached(provider, apiKey, cacheKey);
  return live
    ? { models: live, live: true }
    : { models: AI_PROVIDERS[provider].fallbackModels, live: false };
}

/**
 * Normalizes a stored/picked model against the effective catalog.
 *  • valid model  → kept as-is
 *  • invalid + live list → provider default (or first model when the default
 *    isn't available to this key)
 *  • invalid + fallback list → trust the explicit value: the fallback may be
 *    stale/incomplete, so resetting it would silently discard a valid pick.
 */
function normalizeFromList(
  list: AiProviderModel[],
  live: boolean,
  model: string,
  defaultModel: string,
): string {
  const trimmed = model.trim();
  if (trimmed && list.some((m) => m.id === trimmed)) return trimmed;
  if (live) {
    return list.some((m) => m.id === defaultModel)
      ? defaultModel
      : (list[0]?.id ?? defaultModel);
  }
  return trimmed || defaultModel;
}

// ============================================================================
// Repo API
// ============================================================================

/**
 * Returns the user's ACTIVE AI configuration — provider, model, and the
 * decrypted key for that provider — or null when unset/undecryptable. No
 * cross-provider fallback: if the active provider's key is missing, AI is
 * disabled (the dashboard shows per-provider status so the user can switch).
 *
 * HOT PATH: runs on every AI message. Deliberately fetch-free — the stored
 * model was validated against the live catalog at save time, so it's trusted
 * as-is (empty/invalid → provider default).
 *
 * The config is scoped to a single user's account — callers must resolve the
 * account id from the bot session (`ctx.native.userId`) and never pass another
 * user's id.
 */
export async function getAiProviderConfig(
  userId: string,
): Promise<AiRuntimeConfig | null> {
  if (!userId) return null;
  const cached = lruCache.get<AiRuntimeConfig | null>(aiConfigCacheKey(userId));
  if (cached !== undefined) return cached;
  const stored = await _getUserAiConfig(userId);
  let result: AiRuntimeConfig | null = null;
  if (stored) {
    const provider = providerOf(stored.provider);
    const encryptedKey =
      provider === 'openrouter'
        ? stored.openrouterEncryptedKey
        : stored.encryptedKey;
    if (encryptedKey) {
      try {
        const apiKey = decrypt(encryptedKey);
        if (apiKey) {
          const storedModel = (
            provider === 'openrouter' ? stored.openrouterModel : stored.groqModel
          ).trim();
          result = {
            provider,
            model: storedModel || AI_PROVIDERS[provider].defaultModel,
            apiKey,
          };
        }
      } catch {
        // Corrupt/tampered ciphertext — treat as "no config" so AI stays
        // disabled rather than leaking or failing with a cryptic error.
        result = null;
      }
    }
  }
  lruCache.set(aiConfigCacheKey(userId), result);
  return result;
}

/** Dashboard status payload — per-provider presence + hints, never keys. */
export async function getAiSettingsStatus(
  userId: string,
): Promise<AiSettingsStatus> {
  if (!userId) {
    return buildEmptyStatus();
  }
  const stored = await _getUserAiConfig(userId);
  if (!stored) return buildEmptyStatus();

  const provider = providerOf(stored.provider);

  // Decrypt the stored Groq key (if any) so the live Groq catalog can be
  // fetched — Groq's model list is per-key. Fail-open: no key / decrypt error
  // just falls back to the static catalog.
  let groqKey: string | null = null;
  if (stored.encryptedKey) {
    try {
      groqKey = decrypt(stored.encryptedKey);
    } catch {
      groqKey = null;
    }
  }

  // Both catalogs are cached (6h) — parallel fetch, sequential after warm-up.
  const [groqList, openrouterList] = await Promise.all([
    resolveModelList('groq', groqKey, userId),
    resolveModelList('openrouter'),
  ]);

  const groqModel = normalizeFromList(
    groqList.models,
    groqList.live,
    stored.groqModel,
    AI_PROVIDERS.groq.defaultModel,
  );
  const openrouterModel = normalizeFromList(
    openrouterList.models,
    openrouterList.live,
    stored.openrouterModel,
    AI_PROVIDERS.openrouter.defaultModel,
  );

  return {
    provider,
    model: provider === 'openrouter' ? openrouterModel : groqModel,
    groqModel,
    openrouterModel,
    providers: {
      groq: {
        hasKey: stored.encryptedKey.length > 0,
        keyHint: stored.keyHint || null,
      },
      openrouter: {
        hasKey: stored.openrouterEncryptedKey.length > 0,
        keyHint: stored.openrouterKeyHint || null,
      },
    },
    models: {
      groq: groqList.models,
      openrouter: openrouterList.models,
    },
  };
}

/**
 * Saves the user's AI config: validates the provider/model (against the live
 * catalog), encrypts + stores the key when one is provided (and switches the
 * active provider to it), otherwise just persists the provider/model
 * selection. Requires an API key when the selected provider doesn't have one.
 */
export async function saveUserAiConfig(
  userId: string,
  payload: SaveAiConfigPayload,
): Promise<AiSettingsStatus> {
  if (!userId) throw new AiConfigError('Not authenticated');

  const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';

  // Provider auto-detection: when a key is present, its format identifies the
  // provider (`gsk_` → Groq, `sk-or-v1-` → OpenRouter) and wins over the
  // submitted provider. A malformed key falls back to the submitted provider
  // so the validation below reports a useful format error.
  let provider: AiProviderId | null = isAiProviderId(payload.provider)
    ? payload.provider
    : null;
  if (apiKey) {
    provider = detectAiProviderFromKey(apiKey) ?? provider;
  }
  if (!provider) {
    throw new AiConfigError('Invalid AI provider.');
  }
  const providerDef = AI_PROVIDERS[provider];

  if (apiKey && !isValidAiProviderKey(provider, apiKey)) {
    throw new AiConfigError(
      provider === 'groq'
        ? 'Invalid Groq API key. Keys start with "gsk_" and are at least 20 characters long.'
        : 'Invalid OpenRouter API key. Keys start with "sk-or-v1-" and are at least 20 characters long.',
    );
  }

  const stored = await _getUserAiConfig(userId);
  let storedGroqKey: string | null = null;
  if (stored?.encryptedKey) {
    try {
      storedGroqKey = decrypt(stored.encryptedKey);
    } catch {
      storedGroqKey = null;
    }
  }

  // Resolve the live (or fallback) catalog for this provider so the picked
  // model is validated/normalized against what's actually available. When a
  // new Groq key is being saved, prefer it for the fetch.
  const fetchKey = provider === 'groq' ? (apiKey || storedGroqKey) : undefined;
  const { models: providerModels, live } = await resolveModelList(
    provider,
    fetchKey,
    userId,
  );

  const model = payload.model
    ? normalizeFromList(
        providerModels,
        live,
        payload.model,
        providerDef.defaultModel,
      )
    : providerModels.some((m) => m.id === providerDef.defaultModel)
      ? providerDef.defaultModel
      : (providerModels[0]?.id ?? providerDef.defaultModel);

  if (apiKey) {
    await _saveUserAiKey(
      userId,
      provider,
      encrypt(apiKey),
      getAiProviderKeyHint(apiKey),
      model,
    );
  } else {
    // No new key — require the provider to already have one before we persist
    // a provider/model switch (a model-only save on a keyless provider would
    // silently no-op on the DB row).
    const hasKey =
      stored !== null &&
      (provider === 'openrouter'
        ? stored.openrouterEncryptedKey.length > 0
        : stored.encryptedKey.length > 0);
    if (!hasKey) {
      throw new AiConfigError(
        `An ${providerDef.label} API key is required before saving.`,
      );
    }
    await _updateUserAiModel(userId, provider, model);
  }

  // Invalidate the cached runtime config so the next AI invocation sees the
  // new provider/model/key immediately.
  lruCache.del(aiConfigCacheKey(userId));
  return getAiSettingsStatus(userId);
}

/** Removes the stored key for ONE provider (the other stays intact). */
export async function removeUserAiKey(
  userId: string,
  provider: AiProviderId,
): Promise<AiSettingsStatus> {
  if (!userId) throw new AiConfigError('Not authenticated');
  if (!isAiProviderId(provider)) {
    throw new AiConfigError('Invalid AI provider.');
  }
  await _deleteUserAiKey(userId, provider);
  lruCache.del(aiConfigCacheKey(userId));
  return getAiSettingsStatus(userId);
}

// ============================================================================
// Helpers
// ============================================================================

function providerOf(value: string | undefined): AiProviderId {
  return isAiProviderId(value) ? value : 'groq';
}

function buildEmptyStatus(): AiSettingsStatus {
  return {
    provider: 'groq',
    model: AI_PROVIDERS.groq.defaultModel,
    groqModel: AI_PROVIDERS.groq.defaultModel,
    openrouterModel: AI_PROVIDERS.openrouter.defaultModel,
    providers: {
      groq: { hasKey: false, keyHint: null },
      openrouter: { hasKey: false, keyHint: null },
    },
    models: {
      groq: AI_PROVIDERS.groq.fallbackModels,
      openrouter: AI_PROVIDERS.openrouter.fallbackModels,
    },
  };
}
