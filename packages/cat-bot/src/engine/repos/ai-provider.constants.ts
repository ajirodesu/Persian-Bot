/**
 * AI Provider Catalog — single source of truth for every LLM provider the bot's
 * agent can run on (currently Groq and OpenRouter). Used by:
 *   • the settings API (dashboard model lists + provider labels),
 *   • key/model validation before anything reaches the database,
 *   • the agent's client factory (per-provider base URL + model selection).
 *
 * Both providers speak the OpenAI-compatible chat-completions API, so the same
 * SDK (groq-sdk) drives both — only the base URL and model id differ.
 *
 * Model catalogs: the FULL model list is fetched live from each provider's
 * /models endpoint (see ai-model-catalog.lib.ts) so every model — including all
 * free ones — is selectable. `fallbackModels` is a small curated list used only
 * when the live fetch fails (offline resilience).
 */

export type AiProviderId = 'groq' | 'openrouter';

export interface AiProviderModel {
  /** The model id sent to the provider's API (e.g. "openai/gpt-oss-120b"). */
  id: string;
  /** Human-friendly label shown in the dashboard picker. */
  label: string;
  /** True for free models (OpenRouter `:free` variants / zero pricing). */
  free?: boolean;
}

export interface AiProviderDefinition {
  id: AiProviderId;
  label: string;
  description: string;
  /** OpenAI-compatible API root; undefined → use the SDK's default (Groq). */
  baseURL?: string;
  /** URL of the provider's OpenAI-compatible /models endpoint (live catalog). */
  modelsUrl: string;
  /** Placeholder shown in the dashboard key input (e.g. "gsk_…"). */
  keyPlaceholder: string;
  keyPattern: RegExp;
  defaultModel: string;
  /** Static catalog — fallback only, used when the live model fetch fails. */
  fallbackModels: AiProviderModel[];
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderDefinition> = {
  groq: {
    id: 'groq',
    label: 'Groq',
    description: 'Ultra-fast inference on Groq LPU hardware.',
    modelsUrl: 'https://api.groq.com/openai/v1/models',
    keyPlaceholder: 'gsk_…',
    // Groq keys always begin with "gsk_" followed by a base64url token.
    keyPattern: /^gsk_[A-Za-z0-9_-]{20,}$/,
    defaultModel: 'openai/gpt-oss-120b',
    fallbackModels: [
      { id: 'openai/gpt-oss-120b', label: 'OpenAI GPT-OSS 120B' },
      { id: 'openai/gpt-oss-20b', label: 'OpenAI GPT-OSS 20B' },
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
      { id: 'qwen/qwen3-32b', label: 'Qwen 3 32B' },
      { id: 'qwen/qwen3-8b', label: 'Qwen 3 8B' },
    ],
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    description:
      'One API for many models — GPT, Claude, Gemini, Llama and more.',
    baseURL: 'https://openrouter.ai/api/v1',
    modelsUrl: 'https://openrouter.ai/api/v1/models',
    keyPlaceholder: 'sk-or-v1-…',
    // OpenRouter keys begin with "sk-or-v1-" followed by a base64url token.
    keyPattern: /^sk-or-v1-[A-Za-z0-9_-]{20,}$/,
    defaultModel: 'openai/gpt-4o',
    fallbackModels: [
      { id: 'openai/gpt-4o', label: 'OpenAI GPT-4o' },
      { id: 'openai/gpt-4o-mini', label: 'OpenAI GPT-4o Mini' },
      { id: 'anthropic/claude-3.7-sonnet', label: 'Anthropic Claude 3.7 Sonnet' },
      { id: 'anthropic/claude-3.5-sonnet', label: 'Anthropic Claude 3.5 Sonnet' },
      { id: 'google/gemini-2.0-flash-001', label: 'Google Gemini 2.0 Flash' },
      { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct' },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'mistralai/mistral-small-3.1-24b-instruct', label: 'Mistral Small 3.1 24B' },
    ],
  },
};

export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProviderId[];

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && value in AI_PROVIDERS;
}

export function getAiProvider(id: string): AiProviderDefinition | null {
  return isAiProviderId(id) ? AI_PROVIDERS[id] : null;
}

/** Structural validation only — never sends a request to verify the key. */
export function isValidAiProviderKey(
  provider: AiProviderId,
  apiKey: string,
): boolean {
  return AI_PROVIDERS[provider].keyPattern.test(apiKey.trim());
}

/**
 * Infers the provider from a complete key's format: `gsk_…` → Groq,
 * `sk-or-v1-…` → OpenRouter. Returns null for keys that match neither pattern
 * (e.g. a malformed key mid-typing). Used to auto-match the provider when a key
 * is added — the key's format wins over any pre-selected provider.
 */
export function detectAiProviderFromKey(apiKey: string): AiProviderId | null {
  const trimmed = apiKey.trim();
  if (AI_PROVIDERS.groq.keyPattern.test(trimmed)) return 'groq';
  if (AI_PROVIDERS.openrouter.keyPattern.test(trimmed)) return 'openrouter';
  return null;
}

/** Last 4 characters — the only part of a key ever surfaced for display. */
export function getAiProviderKeyHint(apiKey: string): string {
  return apiKey.trim().slice(-4);
}
