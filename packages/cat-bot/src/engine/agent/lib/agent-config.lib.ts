/**
 * AI Agent — Per-User Config Resolution
 *
 * Resolves the effective config for an agent turn. ALL AI configuration is
 * web-based: the dashboard settings page writes per-user rows (provider
 * keys/models plus the agent behavior settings in the JSON blob), and this
 * module turns them into the concrete values the engine runs with. There are
 * NO AI environment variables — a user must save a provider key in the
 * dashboard (AI Integration) before the agent can answer; the small set of
 * non-user defaults (default provider, trigger word, limits) are hardcoded
 * constants below.
 *
 * The per-user row is keyed by the bot's native.userId — the better-auth
 * account that owns the bot session — so a user's dashboard settings are used
 * by their own bots automatically.
 *
 * Resolution is LRU-cached per user for a short TTL: provider/key/model change
 * rarely, and maybeRunAgentOnChat calls this on every message, so caching keeps
 * the hot path off the DB while the dashboard UI stays responsive.
 */

import { getUserAiConfig } from 'database';
import { decrypt } from '@/engine/utils/crypto.util.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';
import { getUserTimezoneOrDefault } from '@/engine/repos/timezone.repo.js';
import {
  AI_PROVIDERS,
  getFreeModelOf,
  isFreeOrAutoModel,
  type AiProviderId,
} from '@/engine/repos/ai-provider.constants.js';
import {
  type AgentProviderId,
  isAgentProviderId,
} from './agent-providers.lib.js';

// ── Hardcoded defaults (no env vars — everything is web-configured) ──────────

/** Provider used when a user has no saved config. */
export const DEFAULT_AI_PROVIDER: AgentProviderId = 'openrouter';

/** Default trigger word when the user hasn't set one in the dashboard. */
export const DEFAULT_AGENT_NAME = 'Cat-Bot';

export interface ResolvedAgentConfig {
  provider: AgentProviderId;
  apiKey?: string | undefined;
  model: string;
  // ── Agent behavior (hardcoded defaults when the user hasn't set a value) ───
  /** Trigger word that activates the agent in plain chat. */
  agentName: string;
  /** Max tool-call iterations per agent turn. */
  maxToolIterations: number;
  /** Max messages kept per agent thread. */
  maxHistory: number;
  /** Agent conversation-thread TTL (seconds). */
  threadTtl: number;
  /** The user's dashboard timezone (IANA name, 'UTC' when unset) — the agent
   * renders "now" in this zone instead of server UTC. */
  timezone: string;
}

interface StoredAiConfigLike {
  provider: string;
  openrouterEncryptedKey: string;
  openrouterModel: string;
  groqEncryptedKey: string;
  groqModel: string;
  nvidiaEncryptedKey: string;
  nvidiaModel: string;
  openaiEncryptedKey: string;
  openaiModel: string;
  geminiEncryptedKey: string;
  geminiModel: string;
  zenEncryptedKey: string;
  zenModel: string;
  agentSettings: Record<string, unknown>;
}

const CACHE_TTL_MS = 30_000; // 30s — dashboard saves appear quickly, hot path stays off-DB
const cacheKey = (userId: string): string => `agent:config:${userId}`;

function storedKeyOf(stored: StoredAiConfigLike, provider: string): string {
  const record = stored as unknown as Record<string, string>;
  return record[`${provider}EncryptedKey`] ?? '';
}

function storedModelOf(stored: StoredAiConfigLike, provider: string): string {
  const record = stored as unknown as Record<string, string>;
  return record[`${provider}Model`] ?? '';
}

/** Default model for a provider — from the dashboard catalog (no env). */
function defaultModelOf(provider: AgentProviderId): string {
  const def = AI_PROVIDERS[provider as AiProviderId];
  return def?.defaultModel ?? AI_PROVIDERS.openrouter.defaultModel;
}

/**
 * Free/auto model auto-preference: for providers that support a free/auto
 * model, prefer it over the saved (possibly paid) model so turns don't
 * instantly hit the provider's rate limit. A user's own free-model choice is
 * respected — it's already free. Providers without a free tier keep the
 * user's saved model untouched.
 */
function preferFreeModel(provider: AgentProviderId, model: string): string {
  const id = provider as AiProviderId;
  const free = getFreeModelOf(id);
  if (free && !isFreeOrAutoModel(id, model)) return free;
  return model;
}

/** Resolved agent behavior with hardcoded defaults (never throws). */
export function resolveAgentBehavior(): Omit<
  ResolvedAgentConfig,
  'provider' | 'apiKey' | 'model'
> {
  return {
    agentName: DEFAULT_AGENT_NAME,
    maxToolIterations: 5,
    maxHistory: 20,
    threadTtl: 3600,
    // Matches the dashboard's fallback when a user hasn't picked a timezone.
    timezone: 'UTC',
  };
}

/**
 * Resolves the effective agent config for a user. Never throws — every failure
 * path degrades to the hardcoded defaults so a DB or decrypt error can never
 * crash an agent turn. Cached 30s per user.
 */
export async function resolveAgentConfig(
  userId?: string,
): Promise<ResolvedAgentConfig> {
  if (userId) {
    const cached = lruCache.get<ResolvedAgentConfig>(cacheKey(userId));
    if (cached) return cached;

    try {
      const stored = (await getUserAiConfig(
        userId,
      )) as StoredAiConfigLike | null;
      if (stored) {
        // The stored provider column is the single source of truth; a stale
        // pointer to a keyless provider falls back to the default so a
        // configured key still powers the agent.
        const blob = stored.agentSettings ?? {};
        let provider: AgentProviderId = isAgentProviderId(stored.provider)
          ? (stored.provider as AgentProviderId)
          : DEFAULT_AI_PROVIDER;
        let storedKey = storedKeyOf(stored, provider);
        if (!storedKey && provider !== DEFAULT_AI_PROVIDER) {
          provider = DEFAULT_AI_PROVIDER;
          storedKey = storedKeyOf(stored, provider);
        }
        const storedModel = storedModelOf(stored, provider).trim();
        if (storedKey) {
          let apiKey: string | undefined;
          try {
            apiKey = decrypt(storedKey);
          } catch {
            apiKey = undefined;
          }

          const resolved: ResolvedAgentConfig = {
            provider,
            // A user with a stored key but empty model (fresh row) still gets a
            // sensible default — never send an empty model to the provider.
            apiKey: apiKey || undefined,
            model: preferFreeModel(provider, storedModel || defaultModelOf(provider)),
            ...resolveBehaviorWithBlob(blob),
            // The dashboard timezone lives in its own table (not the blob).
            timezone: await getUserTimezoneOrDefault(userId),
          };
          lruCache.set(cacheKey(userId), resolved, CACHE_TTL_MS);
          return resolved;
        }
      }
    } catch {
      // Fall through to defaults — see function contract above.
    }
  }

  // No stored config (or no userId) — the user must save a key in the
  // dashboard before the agent can answer; there is no env fallback key.
  const resolved: ResolvedAgentConfig = {
    provider: DEFAULT_AI_PROVIDER,
    apiKey: undefined,
    model: preferFreeModel(
      DEFAULT_AI_PROVIDER,
      defaultModelOf(DEFAULT_AI_PROVIDER),
    ),
    ...resolveAgentBehavior(),
    // Still honor the user's dashboard timezone when they have one.
    timezone: await getUserTimezoneOrDefault(userId ?? ''),
  };
  if (userId) lruCache.set(cacheKey(userId), resolved, CACHE_TTL_MS);
  return resolved;
}

/** Agent behavior from the stored blob, falling back to the defaults per field. */
function resolveBehaviorWithBlob(
  blob: Record<string, unknown>,
): Omit<ResolvedAgentConfig, 'provider' | 'apiKey' | 'model'> {
  const defaults = resolveAgentBehavior();
  const name = blob['agentName'];
  const maxIter = blob['maxToolIterations'];
  const maxHist = blob['maxHistory'];
  const ttl = blob['threadTtl'];
  return {
    agentName:
      typeof name === 'string' && name.trim()
        ? name.trim().toLowerCase()
        : defaults.agentName,
    maxToolIterations:
      typeof maxIter === 'number' && maxIter > 0
        ? Math.min(Math.floor(maxIter), 20)
        : defaults.maxToolIterations,
    maxHistory:
      typeof maxHist === 'number' && maxHist > 0
        ? Math.min(Math.floor(maxHist), 100)
        : defaults.maxHistory,
    threadTtl:
      typeof ttl === 'number' && ttl > 0
        ? Math.min(Math.floor(ttl), 86_400)
        : defaults.threadTtl,
    // Timezone isn't stored in the blob — it lives in the dashboard timezone
    // table, resolved separately in resolveAgentConfig.
    timezone: defaults.timezone,
  };
}

/**
 * Resolves a stored API key for ANY provider, regardless of which provider is
 * active — used by commands like /nano that need a specific provider's key
 * (Gemini) even when the user's active agent provider is different. Returns
 * undefined when the user has no stored (decryptable) key for that provider.
 * Cached alongside the resolved config (30s per user).
 */
export async function resolveStoredApiKey(
  userId: string | undefined,
  provider: AgentProviderId,
): Promise<string | undefined> {
  if (!userId) return undefined;
  const cached = lruCache.get<ResolvedAgentConfig>(cacheKey(userId));
  const stored = (await getUserAiConfig(userId)) as
    | StoredAiConfigLike
    | null;
  if (!stored) {
    return cached?.provider === provider ? cached.apiKey : undefined;
  }
  const encKey = storedKeyOf(stored, provider);
  if (!encKey) return undefined;
  try {
    return decrypt(encKey) || undefined;
  } catch {
    return undefined;
  }
}

/** Invalidates the cache for a user — called after dashboard saves. */
export function invalidateAgentConfig(userId: string): void {
  lruCache.del(cacheKey(userId));
}
