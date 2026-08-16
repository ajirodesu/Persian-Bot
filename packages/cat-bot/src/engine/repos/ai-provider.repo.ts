import {
  getUserAiConfig as _getUserAiConfig,
  saveUserAiKey as _saveUserAiKey,
  updateUserAiModel as _updateUserAiModel,
  deleteUserAiKey as _deleteUserAiKey,
  saveUserAgentSettings as _saveUserAgentSettings,
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

/** Per-user agent behavior settings (web-configurable — env vars are the fallback). */
export interface AgentSettingsPayload {
  /** Trigger word that activates the agent in plain chat (default: Cat-Bot). */
  agentName?: string;
  /** Whether the shell tool is exposed to the agent. */
  shellEnabled?: boolean;
  /** Max tool-call iterations per agent turn. */
  maxToolIterations?: number;
  /** Max messages kept per agent thread. */
  maxHistory?: number;
  /** Agent conversation-thread TTL (seconds). */
  threadTtl?: number;
}

export const AGENT_SETTINGS_DEFAULTS: Required<AgentSettingsPayload> = {
  agentName: '',
  shellEnabled: true,
  maxToolIterations: 5,
  maxHistory: 20,
  threadTtl: 3600,
};

/** Full dashboard payload — per-provider connection status, the active
 * provider + model, each provider's remembered model, the model catalog,
 * and the user's agent settings. */
export interface AiSettingsStatus {
  provider: AiProviderId;
  model: string;
  openrouterModel: string;
  groqModel: string;
  nvidiaModel: string;
  openaiModel: string;
  geminiModel: string;
  providers: Record<AiProviderId, AiProviderKeyStatus>;
  models: Record<AiProviderId, AiProviderModel[]>;
  agent: Required<AgentSettingsPayload>;
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
  /** Agent behavior settings — merged into the user's stored blob. */
  settings?: AgentSettingsPayload;
}

// ============================================================================
// Stored-config helpers
// ============================================================================
// The database stores one key+model slot per provider. The three original
// providers (groq/openrouter/nvidia) keep their dedicated columns; the newer
// ones (openai/gemini) live in the JSON agent_settings blob along with the
// agent behavior settings. `provider` picks the active one; for the newer
// providers the blob's activeProvider field wins over the legacy column.

interface StoredAiConfigLike {
  encryptedKey: string;
  keyHint: string;
  openrouterEncryptedKey: string;
  openrouterKeyHint: string;
  nvidiaEncryptedKey: string;
  nvidiaKeyHint: string;
  provider: string;
  groqModel: string;
  openrouterModel: string;
  nvidiaModel: string;
  agentSettings: Record<string, unknown>;
}

function blobOf(stored: StoredAiConfigLike): Record<string, unknown> {
  return stored.agentSettings ?? {};
}

/** Active provider: the blob's activeProvider (openai/gemini) wins, then the
 * legacy provider column, then the env-level default. */
function activeProviderOf(stored: StoredAiConfigLike): AiProviderId {
  const blob = blobOf(stored);
  if (isAiProviderId(blob['activeProvider'])) return blob['activeProvider'];
  return isAiProviderId(stored.provider) ? stored.provider : 'openrouter';
}

function storedKeyOf(
  stored: StoredAiConfigLike,
  provider: AiProviderId,
): string {
  if (provider === 'openrouter') return stored.openrouterEncryptedKey;
  if (provider === 'nvidia') return stored.nvidiaEncryptedKey;
  if (provider === 'groq') return stored.encryptedKey;
  const blob = blobOf(stored);
  const key = String(blob[`${provider}EncryptedKey`] ?? '');
  return key;
}

function storedModelOf(
  stored: StoredAiConfigLike,
  provider: AiProviderId,
): string {
  if (provider === 'openrouter') return stored.openrouterModel;
  if (provider === 'nvidia') return stored.nvidiaModel;
  if (provider === 'groq') return stored.groqModel;
  const blob = blobOf(stored);
  const model = String(blob[`${provider}Model`] ?? '');
  return model;
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
// Agent settings helpers
// ============================================================================

/** Reads the user's web-configured agent settings (empty → defaults from env
 * are applied by the engine's agent-config resolver, not here). */
export async function getUserAgentSettings(
  userId: string,
): Promise<AgentSettingsPayload> {
  const stored = await _getUserAiConfig(userId);
  const blob = stored ? (stored.agentSettings ?? {}) : {};
  const out: AgentSettingsPayload = {};
  const pick = (key: string): string | undefined => {
    const v = blob[key];
    return typeof v === 'string' ? v : undefined;
  };
  const pickBool = (key: string): boolean | undefined => {
    const v = blob[key];
    return typeof v === 'boolean' ? v : undefined;
  };
  const pickNum = (key: string): number | undefined => {
    const v = blob[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const agentName = pick('agentName');
  if (agentName) out.agentName = agentName;
  const shellEnabled = pickBool('shellEnabled');
  if (shellEnabled !== undefined) out.shellEnabled = shellEnabled;
  const maxToolIterations = pickNum('maxToolIterations');
  if (maxToolIterations !== undefined) {
    out.maxToolIterations = maxToolIterations;
  }
  const maxHistory = pickNum('maxHistory');
  if (maxHistory !== undefined) out.maxHistory = maxHistory;
  const threadTtl = pickNum('threadTtl');
  if (threadTtl !== undefined) out.threadTtl = threadTtl;
  return out;
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

  const provider = activeProviderOf(stored);
  const blob = blobOf(stored);

  // Decrypt keys so live catalogs can be fetched where per-key (groq/nvidia/
  // openai). Fail-open: no key / decrypt error just falls back to the static
  // catalog.
  const decryptKey = (enc: string): string | null => {
    if (!enc) return null;
    try {
      return decrypt(enc);
    } catch {
      return null;
    }
  };

  const groqKey = decryptKey(stored.encryptedKey);
  const nvidiaKey = decryptKey(stored.nvidiaEncryptedKey);
  const openaiKey = decryptKey(String(blob['openaiEncryptedKey'] ?? ''));

  // Catalogs are cached (6h) — parallel fetch, sequential after warm-up.
  const [openrouterList, groqList, nvidiaList, openaiList] = await Promise.all([
    resolveModelList('openrouter'),
    resolveModelList('groq', groqKey, userId),
    resolveModelList('nvidia', nvidiaKey, userId),
    resolveModelList('openai', openaiKey, userId),
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
  const openaiModel = normalizeFromList(
    openaiList.models,
    openaiList.live,
    storedModelOf(stored, 'openai'),
    AI_PROVIDERS.openai.defaultModel,
  );
  const geminiModel = normalizeFromList(
    AI_PROVIDERS.gemini.fallbackModels,
    false,
    storedModelOf(stored, 'gemini'),
    AI_PROVIDERS.gemini.defaultModel,
  );

  const activeModel =
    provider === 'openrouter'
      ? openrouterModel
      : provider === 'nvidia'
        ? nvidiaModel
        : provider === 'openai'
          ? openaiModel
          : provider === 'gemini'
            ? geminiModel
            : groqModel;

  const agent = await getUserAgentSettings(userId);

  return {
    provider,
    model: activeModel,
    openrouterModel,
    groqModel,
    nvidiaModel,
    openaiModel,
    geminiModel,
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
      openai: {
        hasKey: String(blob['openaiEncryptedKey'] ?? '').length > 0,
        keyHint: (blob['openaiKeyHint'] as string | undefined) ?? null,
      },
      gemini: {
        hasKey: String(blob['geminiEncryptedKey'] ?? '').length > 0,
        keyHint: (blob['geminiKeyHint'] as string | undefined) ?? null,
      },
    },
    models: {
      openrouter: openrouterList.models,
      groq: groqList.models,
      nvidia: nvidiaList.models,
      openai: openaiList.models,
      gemini: AI_PROVIDERS.gemini.fallbackModels,
    },
    agent: { ...AGENT_SETTINGS_DEFAULTS, ...agent },
  };
}

/**
 * Saves the user's AI config: validates the provider/model (against the live
 * catalog), encrypts + stores the key when one is provided (and switches the
 * active provider to it), otherwise just persists the provider/model
 * selection. Requires an API key when the selected provider doesn't have one.
 * Agent behavior settings are merged into the stored blob when present.
 */
export async function saveUserAiConfig(
  userId: string,
  payload: SaveAiConfigPayload,
): Promise<AiSettingsStatus> {
  if (!userId) throw new AiConfigError('Not authenticated');

  const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';

  // Provider auto-detection: when a key is present, its format identifies the
  // provider (`sk-or-v1-` → OpenRouter, `gsk_` → Groq, `nvapi-` → NVIDIA) and
  // wins over the submitted provider. A malformed key falls back to the
  // submitted provider so the validation below reports a useful format error.
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

  const stored = (await _getUserAiConfig(userId)) as StoredAiConfigLike | null;
  const blob = stored ? blobOf(stored) : {};
  const decryptKey = (enc: string): string | null => {
    if (!enc) return null;
    try {
      return decrypt(enc);
    } catch {
      return null;
    }
  };
  const storedKey =
    provider === 'groq'
      ? decryptKey(stored?.encryptedKey ?? '')
      : provider === 'nvidia'
        ? decryptKey(stored?.nvidiaEncryptedKey ?? '')
        : provider === 'openai' || provider === 'gemini'
          ? decryptKey(String(blob[`${provider}EncryptedKey`] ?? ''))
          : null;

  // Resolve the live (or fallback) catalog for this provider so the picked
  // model is validated/normalized against what's actually available. When a
  // new key is being saved, prefer it for the fetch.
  const fetchKey =
    provider === 'groq' || provider === 'nvidia' || provider === 'openai'
      ? (apiKey || storedKey || undefined)
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

  // The newer providers (openai/gemini) store their key/model and the
  // active-provider pointer in the agent_settings blob, since the legacy
  // columns only cover groq/openrouter/nvidia.
  const isBlobProvider = provider === 'openai' || provider === 'gemini';
  // Legacy DB columns (the DB-layer AiProvider union).
  const legacyProvider = provider as 'openrouter' | 'groq' | 'nvidia';

  if (apiKey || isBlobProvider) {
    if (isBlobProvider && apiKey) {
      const blobPatch: Record<string, unknown> = {
        [`${provider}EncryptedKey`]: encrypt(apiKey),
        [`${provider}KeyHint`]: getAiProviderKeyHint(apiKey),
        [`${provider}Model`]: model,
        activeProvider: provider,
      };
      await _saveUserAgentSettings(userId, blobPatch);
    } else if (isBlobProvider) {
      // No new key for a blob provider — require one to already exist before
      // persisting a provider/model switch.
      const hasKey = String(blob[`${provider}EncryptedKey`] ?? '').length > 0;
      if (!hasKey) {
        throw new AiConfigError(
          `An ${providerDef.label} API key is required before saving.`,
        );
      }
      await _saveUserAgentSettings(userId, {
        [`${provider}Model`]: model,
        activeProvider: provider,
      });
    } else {
      await _saveUserAiKey(
        userId,
        legacyProvider,
        encrypt(apiKey),
        getAiProviderKeyHint(apiKey),
        model,
      );
    }
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
    await _updateUserAiModel(userId, legacyProvider, model);
  }

  // Agent behavior settings (trigger name, shell toggle, limits).
  if (payload.settings) {
    const patch: Record<string, unknown> = {};
    const s = payload.settings;
    if (typeof s.agentName === 'string' && s.agentName.trim()) {
      patch['agentName'] = s.agentName.trim().slice(0, 32);
    }
    if (typeof s.shellEnabled === 'boolean') {
      patch['shellEnabled'] = s.shellEnabled;
    }
    if (typeof s.maxToolIterations === 'number' && s.maxToolIterations > 0) {
      patch['maxToolIterations'] = Math.min(Math.floor(s.maxToolIterations), 20);
    }
    if (typeof s.maxHistory === 'number' && s.maxHistory > 0) {
      patch['maxHistory'] = Math.min(Math.floor(s.maxHistory), 100);
    }
    if (typeof s.threadTtl === 'number' && s.threadTtl > 0) {
      patch['threadTtl'] = Math.min(Math.floor(s.threadTtl), 86_400);
    }
    if (Object.keys(patch).length > 0) {
      await _saveUserAgentSettings(userId, patch);
    }
  }

  return getAiSettingsStatus(userId);
}

/** Removes the stored key for ONE provider (the others stay intact). */
export async function removeUserAiKey(
  userId: string,
  provider: AiProviderId,
): Promise<AiSettingsStatus> {
  if (!userId) throw new AiConfigError('Not authenticated');
  if (!isAiProviderId(provider)) {
    throw new AiConfigError('Invalid AI provider.');
  }
  if (provider === 'openai' || provider === 'gemini') {
    await _saveUserAgentSettings(userId, {
      [`${provider}EncryptedKey`]: '',
      [`${provider}KeyHint`]: '',
    });
  } else {
    await _deleteUserAiKey(
      userId,
      provider as 'openrouter' | 'groq' | 'nvidia',
    );
  }
  return getAiSettingsStatus(userId);
}

// ============================================================================
// Helpers
// ============================================================================

function buildEmptyStatus(): AiSettingsStatus {
  return {
    provider: 'openrouter',
    model: AI_PROVIDERS.openrouter.defaultModel,
    openrouterModel: AI_PROVIDERS.openrouter.defaultModel,
    groqModel: AI_PROVIDERS.groq.defaultModel,
    nvidiaModel: AI_PROVIDERS.nvidia.defaultModel,
    openaiModel: AI_PROVIDERS.openai.defaultModel,
    geminiModel: AI_PROVIDERS.gemini.defaultModel,
    providers: {
      openrouter: { hasKey: false, keyHint: null },
      groq: { hasKey: false, keyHint: null },
      nvidia: { hasKey: false, keyHint: null },
      openai: { hasKey: false, keyHint: null },
      gemini: { hasKey: false, keyHint: null },
    },
    models: {
      openrouter: AI_PROVIDERS.openrouter.fallbackModels,
      groq: AI_PROVIDERS.groq.fallbackModels,
      nvidia: AI_PROVIDERS.nvidia.fallbackModels,
      openai: AI_PROVIDERS.openai.fallbackModels,
      gemini: AI_PROVIDERS.gemini.fallbackModels,
    },
    agent: { ...AGENT_SETTINGS_DEFAULTS },
  };
}
