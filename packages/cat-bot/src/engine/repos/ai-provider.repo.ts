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

/** Per-user agent behavior settings (web-configurable). */
export interface AgentSettingsPayload {
  /** Trigger word that activates the agent in plain chat (default: Cat-Bot). */
  agentName?: string;
  /** Max tool-call iterations per agent turn. */
  maxToolIterations?: number;
  /** Max messages kept per agent thread. */
  maxHistory?: number;
  /** Agent conversation-thread TTL (seconds). */
  threadTtl?: number;
}

export const AGENT_SETTINGS_DEFAULTS: Required<AgentSettingsPayload> = {
  agentName: '',
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
  zenModel: string;
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
// The database stores one key+model slot per provider in bot_user_ai_config —
// a uniform column pair for every provider (openrouter, groq, nvidia, openai,
// gemini), plus the per-user agent behavior blob. `provider` picks the active
// one; the agent_settings blob holds only agent behavior settings now.

interface StoredAiConfigLike {
  provider: string;
  openrouterEncryptedKey: string;
  openrouterKeyHint: string;
  openrouterModel: string;
  groqEncryptedKey: string;
  groqKeyHint: string;
  groqModel: string;
  nvidiaEncryptedKey: string;
  nvidiaKeyHint: string;
  nvidiaModel: string;
  openaiEncryptedKey: string;
  openaiKeyHint: string;
  openaiModel: string;
  geminiEncryptedKey: string;
  geminiKeyHint: string;
  geminiModel: string;
  zenEncryptedKey: string;
  zenKeyHint: string;
  zenModel: string;
  agentSettings: Record<string, unknown>;
}

/** Active provider: the stored provider column with a key present, else the
 * env-level default. A pointer to a provider with no stored key is ignored
 * (stale) so reads never silently land on a keyless provider. */
function activeProviderOf(stored: StoredAiConfigLike): AiProviderId {
  if (
    isAiProviderId(stored.provider) &&
    storedKeyOf(stored, stored.provider).length > 0
  ) {
    return stored.provider;
  }
  return 'openrouter';
}

/** Picks the best provider to remain active after one provider's key is
 * removed: keep the current pointer if it still has a key, otherwise prefer
 * OpenRouter, then any other configured provider. Returns null when no
 * provider key remains. */
function pickActiveProviderAfterRemoval(
  stored: StoredAiConfigLike,
  removed: AiProviderId,
): AiProviderId | null {
  const hasKey = (p: AiProviderId): boolean =>
    storedKeyOf(stored, p).length > 0;

  const current = activeProviderOf(stored);
  if (current !== removed && hasKey(current)) return current;

  const order: AiProviderId[] = [
    'openrouter',
    'groq',
    'nvidia',
    'openai',
    'gemini',
    'zen',
  ];
  for (const p of order) {
    if (p !== removed && hasKey(p)) return p;
  }
  return null;
}

function storedKeyOf(
  stored: StoredAiConfigLike,
  provider: AiProviderId,
): string {
  return stored[`${provider}EncryptedKey`] ?? '';
}

function storedModelOf(
  stored: StoredAiConfigLike,
  provider: AiProviderId,
): string {
  return stored[`${provider}Model`] ?? '';
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
  const pickNum = (key: string): number | undefined => {
    const v = blob[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const agentName = pick('agentName');
  if (agentName) out.agentName = agentName;
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
  const decryptStoredKey = (p: AiProviderId): string | null =>
    decryptKey(storedKeyOf(stored, p));

  const groqKey = decryptStoredKey('groq');
  const nvidiaKey = decryptStoredKey('nvidia');
  const openaiKey = decryptStoredKey('openai');
  const geminiKey = decryptStoredKey('gemini');

  // Catalogs are cached (6h) — parallel fetch, sequential after warm-up.
  const [openrouterList, groqList, nvidiaList, openaiList, geminiList, zenList] =
    await Promise.all([
      resolveModelList('openrouter'),
      resolveModelList('groq', groqKey, userId),
      resolveModelList('nvidia', nvidiaKey, userId),
      resolveModelList('openai', openaiKey, userId),
      resolveModelList('gemini', geminiKey, userId),
      resolveModelList('zen'),
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
    geminiList.models,
    geminiList.live,
    storedModelOf(stored, 'gemini'),
    AI_PROVIDERS.gemini.defaultModel,
  );
  const zenModel = normalizeFromList(
    zenList.models,
    zenList.live,
    storedModelOf(stored, 'zen'),
    AI_PROVIDERS.zen.defaultModel,
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
            : provider === 'zen'
              ? zenModel
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
    zenModel,
    providers: {
      openrouter: {
        hasKey: stored.openrouterEncryptedKey.length > 0,
        keyHint: stored.openrouterKeyHint || null,
      },
      groq: {
        hasKey: stored.groqEncryptedKey.length > 0,
        keyHint: stored.groqKeyHint || null,
      },
      nvidia: {
        hasKey: stored.nvidiaEncryptedKey.length > 0,
        keyHint: stored.nvidiaKeyHint || null,
      },
      openai: {
        hasKey: stored.openaiEncryptedKey.length > 0,
        keyHint: stored.openaiKeyHint || null,
      },
      gemini: {
        hasKey: stored.geminiEncryptedKey.length > 0,
        keyHint: stored.geminiKeyHint || null,
      },
      zen: {
        hasKey: stored.zenEncryptedKey.length > 0,
        keyHint: stored.zenKeyHint || null,
      },
    },
    models: {
      openrouter: openrouterList.models,
      groq: groqList.models,
      nvidia: nvidiaList.models,
      openai: openaiList.models,
      gemini: geminiList.models,
      zen: zenList.models,
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
  const decryptKey = (enc: string): string | null => {
    if (!enc) return null;
    try {
      return decrypt(enc);
    } catch {
      return null;
    }
  };
  const storedKey = stored
    ? decryptKey(storedKeyOf(stored, provider))
    : null;

  // Resolve the live (or fallback) catalog for this provider so the picked
  // model is validated/normalized against what's actually available. When a
  // new key is being saved, prefer it for the fetch.
  const fetchKey =
    provider === 'groq' || provider === 'nvidia' || provider === 'openai' || provider === 'gemini'
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

  if (apiKey) {
    // Save the key and switch the active provider to it. All providers store
    // their own uniform column pair in bot_user_ai_config.
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

  // Agent behavior settings (trigger name, shell toggle, limits).
  if (payload.settings) {
    const patch: Record<string, unknown> = {};
    const s = payload.settings;
    if (typeof s.agentName === 'string' && s.agentName.trim()) {
      patch['agentName'] = s.agentName.trim().slice(0, 32);
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

  const stored = (await _getUserAiConfig(userId)) as StoredAiConfigLike | null;
  const wasActive = stored !== null && activeProviderOf(stored) === provider;

  await _deleteUserAiKey(userId, provider);

  // If the removed provider was the active one, repoint the active provider to
  // another configured provider so the account never silently stays on a
  // keyless provider.
  if (wasActive) {
    const after = (await _getUserAiConfig(userId)) as StoredAiConfigLike | null;
    const fallback = after
      ? pickActiveProviderAfterRemoval(after, provider)
      : null;
    if (fallback) {
      await _updateUserAiModel(
        userId,
        fallback,
        storedModelOf(after as StoredAiConfigLike, fallback),
      );
    }
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
    zenModel: AI_PROVIDERS.zen.defaultModel,
    providers: {
      openrouter: { hasKey: false, keyHint: null },
      groq: { hasKey: false, keyHint: null },
      nvidia: { hasKey: false, keyHint: null },
      openai: { hasKey: false, keyHint: null },
      gemini: { hasKey: false, keyHint: null },
      zen: { hasKey: false, keyHint: null },
    },
    models: {
      openrouter: AI_PROVIDERS.openrouter.fallbackModels,
      groq: AI_PROVIDERS.groq.fallbackModels,
      nvidia: AI_PROVIDERS.nvidia.fallbackModels,
      openai: AI_PROVIDERS.openai.fallbackModels,
      gemini: AI_PROVIDERS.gemini.fallbackModels,
      zen: AI_PROVIDERS.zen.fallbackModels,
    },
    agent: { ...AGENT_SETTINGS_DEFAULTS },
  };
}
