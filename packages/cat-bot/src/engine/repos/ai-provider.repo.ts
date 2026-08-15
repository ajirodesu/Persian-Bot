import {
  getUserAiConfig as _getUserAiConfig,
  saveUserAiKey as _saveUserAiKey,
  updateUserAiModel as _updateUserAiModel,
  deleteUserAiKey as _deleteUserAiKey,
} from 'database';
import { encrypt, decrypt } from '@/engine/utils/crypto.util.js';
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
  nvidiaModel: string;
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
// Stored-config helpers
// ============================================================================
// The database stores one key+model slot per provider (groq fields double as
// the "legacy" columns). These helpers map a provider to its stored key/model
// so callers never hand-write a chain of provider ternaries.

interface StoredAiConfigLike {
  encryptedKey: string;
  keyHint: string;
  openrouterEncryptedKey: string;
  openrouterKeyHint: string;
  nvidiaEncryptedKey: string;
  nvidiaKeyHint: string;
  provider: AiProviderId;
  groqModel: string;
  openrouterModel: string;
  nvidiaModel: string;
}

function storedKeyOf(
  stored: StoredAiConfigLike,
  provider: AiProviderId,
): string {
  if (provider === 'openrouter') return stored.openrouterEncryptedKey;
  if (provider === 'nvidia') return stored.nvidiaEncryptedKey;
  return stored.encryptedKey;
}

function storedModelOf(
  stored: StoredAiConfigLike,
  provider: AiProviderId,
): string {
  if (provider === 'openrouter') return stored.openrouterModel;
  if (provider === 'nvidia') return stored.nvidiaModel;
  return stored.groqModel;
}

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

  // Decrypt the stored Groq/NVIDIA keys (if any) so those live catalogs can be
  // fetched — their model lists are per-key. Fail-open: no key / decrypt error
  // just falls back to the static catalog.
  let groqKey: string | null = null;
  if (stored.encryptedKey) {
    try {
      groqKey = decrypt(stored.encryptedKey);
    } catch {
      groqKey = null;
    }
  }
  let nvidiaKey: string | null = null;
  if (stored.nvidiaEncryptedKey) {
    try {
      nvidiaKey = decrypt(stored.nvidiaEncryptedKey);
    } catch {
      nvidiaKey = null;
    }
  }

  // Catalogs are cached (6h) — parallel fetch, sequential after warm-up.
  const [openrouterList, groqList, nvidiaList] = await Promise.all([
    resolveModelList('openrouter'),
    resolveModelList('groq', groqKey, userId),
    resolveModelList('nvidia', nvidiaKey, userId),
  ]);

  const openrouterModel = normalizeFromList(
    openrouterList.models,
    openrouterList.live,
    stored.openrouterModel,
    AI_PROVIDERS.openrouter.defaultModel,
  );
  const groqModel = normalizeFromList(
    groqList.models,
    groqList.live,
    stored.groqModel,
    AI_PROVIDERS.groq.defaultModel,
  );
  const nvidiaModel = normalizeFromList(
    nvidiaList.models,
    nvidiaList.live,
    stored.nvidiaModel,
    AI_PROVIDERS.nvidia.defaultModel,
  );

  const activeModel =
    provider === 'openrouter'
      ? openrouterModel
      : provider === 'nvidia'
        ? nvidiaModel
        : groqModel;

  return {
    provider,
    model: activeModel,
    openrouterModel,
    groqModel,
    nvidiaModel,
    providers: {
      openrouter: {
        hasKey: stored.openrouterEncryptedKey.length > 0,
        keyHint: stored.openrouterKeyHint || null,
      },
      groq: {
        hasKey: stored.encryptedKey.length > 0,
        keyHint: stored.keyHint || null,
      },
      nvidia: {
        hasKey: stored.nvidiaEncryptedKey.length > 0,
        keyHint: stored.nvidiaKeyHint || null,
      },
    },
    models: {
      openrouter: openrouterList.models,
      groq: groqList.models,
      nvidia: nvidiaList.models,
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
  // provider (`sk-or-v1-` → OpenRouter, `gsk_` → Groq) and wins over the
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
    const hint = AI_PROVIDERS[provider].keyPlaceholder;
    throw new AiConfigError(
      `Invalid ${providerDef.label} API key. Keys start with "${hint}" and are at least 20 characters long.`,
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
  let storedNvidiaKey: string | null = null;
  if (stored?.nvidiaEncryptedKey) {
    try {
      storedNvidiaKey = decrypt(stored.nvidiaEncryptedKey);
    } catch {
      storedNvidiaKey = null;
    }
  }

  // Resolve the live (or fallback) catalog for this provider so the picked
  // model is validated/normalized against what's actually available. When a
  // new Groq/NVIDIA key is being saved, prefer it for the fetch.
  const fetchKey =
    provider === 'groq'
      ? (apiKey || storedGroqKey)
      : provider === 'nvidia'
        ? (apiKey || storedNvidiaKey)
        : undefined;
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
    const hasKey = stored !== null && storedKeyOf(stored, provider).length > 0;
    if (!hasKey) {
      throw new AiConfigError(
        `An ${providerDef.label} API key is required before saving.`,
      );
    }
    await _updateUserAiModel(userId, provider, model);
  }

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
  return getAiSettingsStatus(userId);
}

// ============================================================================
// Helpers
// ============================================================================

function providerOf(value: string | undefined): AiProviderId {
  return isAiProviderId(value) ? value : 'openrouter';
}

function buildEmptyStatus(): AiSettingsStatus {
  return {
    provider: 'openrouter',
    model: AI_PROVIDERS.openrouter.defaultModel,
    openrouterModel: AI_PROVIDERS.openrouter.defaultModel,
    groqModel: AI_PROVIDERS.groq.defaultModel,
    nvidiaModel: AI_PROVIDERS.nvidia.defaultModel,
    providers: {
      openrouter: { hasKey: false, keyHint: null },
      groq: { hasKey: false, keyHint: null },
      nvidia: { hasKey: false, keyHint: null },
    },
    models: {
      openrouter: AI_PROVIDERS.openrouter.fallbackModels,
      groq: AI_PROVIDERS.groq.fallbackModels,
      nvidia: AI_PROVIDERS.nvidia.fallbackModels,
    },
  };
}
