/**
 * AI Provider Catalog — single source of truth for every LLM provider the
 * dashboard's AI Integration settings support (OpenRouter is the PRIMARY
 * provider; Groq, NVIDIA, OpenAI and Gemini are the additional providers).
 * Used by:
 *   • the settings API (dashboard model lists + provider labels),
 *   • key/model validation before anything reaches the database.
 *
 * Providers that speak the OpenAI-compatible chat-completions API:
 *   openrouter, groq, nvidia, openai
 * Native SDK: gemini (@google/genai).
 *
 * Model catalogs: the FULL model list is fetched live from a provider's
 * /models endpoint where available (see ai-model-catalog.lib.ts) so every model
 * is selectable. `fallbackModels` is a small curated list used when the live
 * fetch fails (offline resilience).
 */

export type AiProviderId =
  | 'openrouter'
  | 'groq'
  | 'nvidia'
  | 'openai'
  | 'gemini'
  | 'zen'
  | 'orcarouter'
  | 'fastrouter';

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
  /**
   * The provider's preferred free/auto model (e.g. an OpenRouter `:free`
   * variant or an auto-routing model like `orcarouter/auto`). Agents auto-use
   * this model instead of the saved (possibly paid) model so turns don't
   * instantly hit provider rate limits. Undefined for providers without a
   * free/auto tier — those keep the user's saved model and are skipped by the
   * automatic rate-limit failover.
   */
  freeModel?: string;
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
    // Free tier — `:free` variants. Preferred to avoid instant rate limits.
    freeModel: 'openai/gpt-4o:free',
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
    // Free tier — no credit card, 30 RPM. Llama 3.1 8B is the free/cheapest pick.
    freeModel: 'llama-3.1-8b-instant',
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
    // /openai/v1 segment.
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
  openai: {
    id: 'openai',
    label: 'OpenAI',
    description:
      "OpenAI's native platform — GPT-5, GPT-4o and the o-series reasoning models.",
    baseURL: 'https://api.openai.com/v1',
    modelsUrl: 'https://api.openai.com/v1/models',
    keyPlaceholder: 'sk-…',
    // OpenAI keys: legacy "sk-…" or project-scoped "sk-proj-…".
    keyPattern: /^sk-(?:proj-)?[A-Za-z0-9_-]{20,}$/,
    defaultModel: 'gpt-4o-mini',
    fallbackModels: [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
      { id: 'o4-mini', label: 'o4 Mini' },
    ],
  },
  gemini: {
    id: 'gemini',
    label: 'AI Studio',
    description:
      'Google AI Studio — Gemini models via the Generative Language API. New keys start with "AQ…" (legacy "AIza…" traffic keys still accepted).',
    // Gemini uses its native SDK for chat; the LIVE model catalog comes from
    // Google AI Studio's Generative Language API (REST, key in query string).
    modelsUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    keyPlaceholder: 'AIza… / AQ…',
    // Legacy Gemini "traffic" keys begin with "AIza"; Google AI Studio now
    // only issues "auth" keys, which begin with "AQ." (optionally with the
    // dot). Both are accepted.
    keyPattern: /^(?:AIza[A-Za-z0-9_-]{20,}|AQ\.?[A-Za-z0-9_-]{15,})$/,
    defaultModel: 'gemini-2.0-flash-001',
    // Free tier — Flash models run on AI Studio's free tier (no card needed).
    freeModel: 'gemini-2.0-flash-001',
    fallbackModels: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
      { id: 'gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.0-flash-lite-001', label: 'Gemini 2.0 Flash Lite' },
      { id: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash (preview)' },
      { id: 'gemini-2.5-pro-preview-05-20', label: 'Gemini 2.5 Pro (preview)' },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    ],
  },
  zen: {
    id: 'zen',
    label: 'OpenCode Zen',
    description:
      'OpenCode Zen — the OpenCode team\u2019s curated, benchmarked model gateway. ' +
      'One API key for GPT, Claude, Gemini, Grok, DeepSeek, Kimi and more, served ' +
      'from OpenAI/Anthropic/openai-compatible endpoints (opencode.ai/zen/v1).',
    baseURL: 'https://opencode.ai/zen/v1',
    modelsUrl: 'https://opencode.ai/zen/v1/models',
    keyPlaceholder: 'sk-…',
    // Zen keys use the standard "sk-" bearer format (no provider-specific prefix).
    keyPattern: /^sk-[A-Za-z0-9_-]{20,}$/,
    // Picked for low latency + strong tool calling (chat-completions family).
    defaultModel: 'gpt-5.4-mini',
    // Free tier — `-free` variants (DeepSeek V4 Flash free / Big Pickle free).
    freeModel: 'deepseek-v4-flash-free',
    fallbackModels: [
      { id: 'gpt-5.4-mini', label: 'GPT 5.4 Mini' },
      { id: 'gpt-5.6-luna', label: 'GPT 5.6 Luna' },
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-flash-free', label: 'DeepSeek V4 Flash — free', free: true },
      { id: 'big-pickle', label: 'Big Pickle — free', free: true },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
      { id: 'grok-4.5', label: 'Grok 4.5' },
      { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' },
    ],
  },
  orcarouter: {
    id: 'orcarouter',
    label: 'OrcaRouter',
    description:
      'OrcaRouter — an adaptive LLM gateway that grades every prompt and routes it to the best ' +
      'model across OpenAI, Anthropic, Gemini, DeepSeek, Qwen and more, with zero token markup.',
    baseURL: 'https://api.orcarouter.ai/v1',
    modelsUrl: 'https://api.orcarouter.ai/v1/models',
    keyPlaceholder: 'sk-orca-…',
    // OrcaRouter keys always begin with "sk-orca-" followed by a token.
    keyPattern: /^sk-orca-[A-Za-z0-9_-]{10,}$/,
    // Flash-tier default — cheap and tool-capable (key longevity).
    defaultModel: 'deepseek/deepseek-v4-flash-0731',
    // Auto-routing model — grades each prompt and picks the best/cheapest route.
    freeModel: 'orcarouter/auto',
    fallbackModels: [
      { id: 'deepseek/deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash' },
      { id: 'orcarouter/auto', label: 'OrcaRouter Auto (adaptive router)' },
      { id: 'qwen/qwen3.7-flash', label: 'Qwen 3.7 Flash' },
      { id: 'deepseek/deepseek-v4-pro-0813', label: 'DeepSeek V4 Pro' },
      { id: 'openai/gpt-4o-mini', label: 'OpenAI GPT-4o Mini' },
      { id: 'google/gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
    ],
  },
  fastrouter: {
    id: 'fastrouter',
    label: 'FastRouter',
    description:
      'FastRouter — a unified LLM gateway for 160+ models with intelligent routing, failover, ' +
      'cost governance and observability through one OpenAI-compatible API.',
    baseURL: 'https://api.fastrouter.ai/api/v1',
    modelsUrl: 'https://api.fastrouter.ai/api/v1/models',
    keyPlaceholder: '…',
    // FastRouter key format is not publicly documented — accept any reasonable
    // length token so valid keys are never rejected.
    keyPattern: /^[A-Za-z0-9_-]{20,}$/,
    // Default picked for strong tool calling.
    defaultModel: 'openai/gpt-oss-120b',
    fallbackModels: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (OpenAI)' },
      { id: 'qwen/qwen3-coder', label: 'Qwen 3 Coder' },
      { id: 'deepseek-ai/deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill 70B' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'openai/gpt-5-mini', label: 'GPT-5 Mini' },
      { id: 'moonshotai/kimi-k2', label: 'Kimi K2' },
    ],
  },
};

export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProviderId[];

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && value in AI_PROVIDERS;
}

/** The provider's preferred free/auto model, or undefined when it has none. */
export function getFreeModelOf(provider: AiProviderId): string | undefined {
  return AI_PROVIDERS[provider]?.freeModel;
}

/**
 * True when a model id is the provider's free/auto model, a `:free`/`-free`
 * variant, or a catalog entry flagged free — used to avoid overriding a user's
 * own free-model choice.
 */
export function isFreeOrAutoModel(
  provider: AiProviderId,
  modelId: string,
): boolean {
  const def = AI_PROVIDERS[provider];
  if (!def) return false;
  if (modelId === def.freeModel) return true;
  if (/:free$/i.test(modelId) || /-free$/i.test(modelId)) return true;
  return def.fallbackModels.some((m) => m.free && m.id === modelId);
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
 * (checked first — the primary provider), `nvapi-…` → NVIDIA, `gsk_…` → Groq,
 * `AIza…`/`AQ…` → Gemini (AI Studio), `sk-proj-…` → OpenAI. Returns null for
 * keys that match neither pattern (e.g. a malformed key mid-typing). Used to
 * auto-match the provider when a key is added — the key's format wins over any
 * pre-selected provider. Legacy bare `sk-…` OpenAI keys are intentionally NOT
 * detected here because the prefix overlaps OpenRouter keys; clients submitting
 * them send the provider explicitly.
 */
export function detectAiProviderFromKey(apiKey: string): AiProviderId | null {
  const trimmed = apiKey.trim();
  if (AI_PROVIDERS.openrouter.keyPattern.test(trimmed)) return 'openrouter';
  if (AI_PROVIDERS.nvidia.keyPattern.test(trimmed)) return 'nvidia';
  if (AI_PROVIDERS.groq.keyPattern.test(trimmed)) return 'groq';
  if (AI_PROVIDERS.gemini.keyPattern.test(trimmed)) return 'gemini';
  if (
    trimmed.startsWith('sk-orca-') &&
    AI_PROVIDERS.orcarouter.keyPattern.test(trimmed)
  ) {
    return 'orcarouter';
  }
  if (
    trimmed.startsWith('sk-proj-') &&
    AI_PROVIDERS.openai.keyPattern.test(trimmed)
  ) {
    return 'openai';
  }
  return null;
}

/** Last 4 characters — the only part of a key ever surfaced for display. */
export function getAiProviderKeyHint(apiKey: string): string {
  return apiKey.trim().slice(-4);
}
