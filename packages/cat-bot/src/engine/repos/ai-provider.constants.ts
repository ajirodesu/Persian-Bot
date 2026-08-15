/**
 * AI Provider Catalog — single source of truth for every LLM provider the bot's
 * agent can run on (OpenRouter is the PRIMARY provider; Groq and NVIDIA are the
 * secondary providers). Used by:
 *   • the settings API (dashboard model lists + provider labels),
 *   • key/model validation before anything reaches the database,
 *   • the agent's client factory (per-provider base URL + model selection).
 *
 * Every provider speaks the OpenAI-compatible chat-completions API, so the same
 * OpenAI-compatible SDK drives them all — only the base URL and model id differ.
 *
 * Model catalogs: the FULL model list is fetched live from each provider's
 * /models endpoint (see ai-model-catalog.lib.ts) so every model — including all
 * free ones — is selectable. `fallbackModels` is a small curated list used only
 * when the live fetch fails (offline resilience).
 */

export type AiProviderId = 'openrouter' | 'groq' | 'nvidia';

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
  /** OpenAI-compatible API root; undefined → use the SDK's default. */
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

// OpenRouter is the PRIMARY provider — it is listed first, supplies the default
// model, and is the fallback whenever a stored/unknown provider value appears.
// Groq and NVIDIA remain available as secondary providers.
export const AI_PROVIDERS: Record<AiProviderId, AiProviderDefinition> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    description:
      'One API for many models — GPT, Claude, Gemini, Llama and more, routed to the fastest available backend.',
    baseURL: 'https://openrouter.ai/api/v1',
    modelsUrl: 'https://openrouter.ai/api/v1/models',
    keyPlaceholder: 'sk-or-v1-…',
    // OpenRouter keys begin with "sk-or-v1-" followed by a base64url token.
    keyPattern: /^sk-or-v1-[A-Za-z0-9_-]{20,}$/,
    // Default model is picked for speed — low latency and strong tool calling.
    defaultModel: 'openai/gpt-4o-mini',
    fallbackModels: [
      { id: 'openai/gpt-4o-mini', label: 'OpenAI GPT-4o Mini' },
      { id: 'openai/gpt-4o', label: 'OpenAI GPT-4o' },
      { id: 'google/gemini-2.0-flash-001', label: 'Google Gemini 2.0 Flash' },
      { id: 'openai/gpt-4o:free', label: 'OpenAI GPT-4o — free', free: true },
      { id: 'anthropic/claude-3.5-sonnet', label: 'Anthropic Claude 3.5 Sonnet' },
      { id: 'anthropic/claude-3.7-sonnet', label: 'Anthropic Claude 3.7 Sonnet' },
      { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct' },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'mistralai/mistral-small-3.1-24b-instruct', label: 'Mistral Small 3.1 24B' },
    ],
  },
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
  nvidia: {
    id: 'nvidia',
    label: 'NVIDIA',
    description:
      'NVIDIA NIM — accelerated LLM inference on NVIDIA hardware (build.nvidia.com).',
    // NVIDIA serves the OpenAI-compatible API directly at /v1/… with NO
    // /openai/v1 segment — the agent's client factory strips the SDK-injected
    // segment for every provider with a custom baseURL.
    baseURL: 'https://integrate.api.nvidia.com/v1',
    modelsUrl: 'https://integrate.api.nvidia.com/v1/models',
    keyPlaceholder: 'nvapi-…',
    // NVIDIA API keys begin with "nvapi-" followed by a token.
    keyPattern: /^nvapi-[A-Za-z0-9_-]{20,}$/,
    // Default picked for strong tool calling + general-purpose answers.
    defaultModel: 'meta/llama-3.3-70b-instruct',
    fallbackModels: [
      { id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct' },
      { id: 'meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B Instruct' },
      { id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', label: 'Nemotron Ultra 253B' },
      { id: 'microsoft/phi-4', label: 'Microsoft Phi-4' },
      { id: 'deepseek-ai/deepseek-r1', label: 'DeepSeek R1' },
      { id: 'qwen/qwen2.5-coder-32b-instruct', label: 'Qwen 2.5 Coder 32B' },
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
 * Infers the provider from a complete key's format: `sk-or-v1-…` → OpenRouter
 * (checked first — the primary provider), `gsk_…` → Groq, `nvapi-…` → NVIDIA.
 * Returns null for keys that match neither pattern (e.g. a malformed key
 * mid-typing). Used to auto-match the provider when a key is added — the key's
 * format wins over any pre-selected provider.
 */
export function detectAiProviderFromKey(apiKey: string): AiProviderId | null {
  const trimmed = apiKey.trim();
  if (AI_PROVIDERS.openrouter.keyPattern.test(trimmed)) return 'openrouter';
  if (AI_PROVIDERS.nvidia.keyPattern.test(trimmed)) return 'nvidia';
  if (AI_PROVIDERS.groq.keyPattern.test(trimmed)) return 'groq';
  return null;
}

/** Last 4 characters — the only part of a key ever surfaced for display. */
export function getAiProviderKeyHint(apiKey: string): string {
  return apiKey.trim().slice(-4);
}
