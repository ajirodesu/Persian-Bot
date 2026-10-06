/**
 * Provider registry + factory + fallback helpers.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

import type { Provider, ProviderConfig } from './types.js';
import {
  GroqProvider,
  OpenRouterProvider,
  DeepInfraProvider,
  VeniceProvider,
  OpenAICompatProvider,
} from './providers.js';

export type {
  Provider,
  ProviderName,
  ProviderConfig,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChoice,
  Usage,
  ToolDefinition,
  ToolCall,
  ToolChoice,
  JSONSchema,
} from './types.js';
export {
  GroqProvider,
  OpenRouterProvider,
  DeepInfraProvider,
  VeniceProvider,
  OpenAICompatProvider,
} from './providers.js';

/**
 * Defaults merged *under* the caller's config, so a caller-supplied baseUrl
 * still wins while timeout / retry behaviour are never lost.
 */
function withDefaults(c: ProviderConfig, defaults: Partial<ProviderConfig>): ProviderConfig {
  return {
    ...defaults,
    ...c,
    apiKey: c.apiKey || defaults.apiKey || '',
    ...(c.baseUrl || defaults.baseUrl ? { baseUrl: c.baseUrl || defaults.baseUrl! } : {}),
  };
}

const registry = new Map<string, (config: ProviderConfig) => Provider>([
  ['groq', (c) => new GroqProvider(c)],
  ['openrouter', (c) => new OpenRouterProvider(c)],
  ['deepinfra', (c) => new DeepInfraProvider(c)],
  ['venice', (c) => new VeniceProvider(c)],
  ['openai', (c) => new OpenAICompatProvider('openai', withDefaults(c, { baseUrl: 'https://api.openai.com/v1' }))],
  ['together', (c) => new OpenAICompatProvider('together', withDefaults(c, { baseUrl: 'https://api.together.xyz/v1' }))],
  ['fireworks', (c) => new OpenAICompatProvider('fireworks', withDefaults(c, { baseUrl: 'https://api.fireworks.ai/inference/v1' }))],
  ['lepton', (c) => new OpenAICompatProvider('lepton', withDefaults(c, { baseUrl: 'https://api.lepton.ai/api/v1' }))],
  ['ollama', (c) => new OpenAICompatProvider('ollama', withDefaults(c, { apiKey: 'ollama', baseUrl: 'http://localhost:11434/v1' }))],
  ['lmstudio', (c) => new OpenAICompatProvider('lmstudio', withDefaults(c, { apiKey: 'lm-studio', baseUrl: 'http://localhost:1234/v1' }))],
]);

export function registerProvider(name: string, factory: (config: ProviderConfig) => Provider): void {
  registry.set(name.toLowerCase(), factory);
}

export function createProvider(name: string, config: ProviderConfig): Provider {
  const factory = registry.get(name.toLowerCase());
  if (!factory) {
    throw new Error(`Unknown provider: "${name}". Available: ${[...registry.keys()].join(', ')}`);
  }
  return factory(config);
}

export function listProviders(): string[] {
  return [...registry.keys()];
}

export interface ProviderWithFallback {
  primary: Provider;
  fallbacks: Provider[];
}

/** Build a primary + fallbacks chain from already-instantiated providers. */
export function createProviderChain(...providers: Provider[]): ProviderWithFallback {
  const [primary, ...fallbacks] = providers.filter((p) => p.isConfigured());
  if (!primary) throw new Error('No configured providers available');
  return { primary, fallbacks };
}

/** Chat with automatic fallback across providers in order. */
export async function chatWithFallback(
  chain: ProviderWithFallback,
  req: Parameters<Provider['chat']>[0],
): Promise<ReturnType<Provider['chat']>> {
  const providers = [chain.primary, ...chain.fallbacks];
  let lastError: Error | null = null;

  for (const provider of providers) {
    try {
      return await provider.chat(req);
    } catch (err) {
      lastError = err as Error;
      continue;
    }
  }

  throw lastError ?? new Error('All providers failed');
}
