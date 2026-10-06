/**
 * Provider implementations — Groq, OpenRouter, DeepInfra, Venice and the
 * generic OpenAI-compatible adapter (OpenAI, Together, Fireworks, Lepton,
 * Ollama, LM Studio, arbitrary custom endpoints).
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

import { BaseProvider } from './base.js';
import type { ProviderConfig, ChatCompletionRequest } from './types.js';

// ── Groq ─────────────────────────────────────────────────────────────────────

export class GroqProvider extends BaseProvider {
  readonly name = 'groq';
  readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super({ maxRetries: 2, timeout: 30_000, ...config });
    this.baseUrl = config.baseUrl ?? 'https://api.groq.com/openai/v1';
  }
}

export function createGroq(apiKey: string): GroqProvider {
  return new GroqProvider({ apiKey });
}

// ── OpenRouter ───────────────────────────────────────────────────────────────

export class OpenRouterProvider extends BaseProvider {
  readonly name = 'openrouter';
  readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super({ maxRetries: 2, timeout: 60_000, ...config });
    this.baseUrl = config.baseUrl ?? 'https://openrouter.ai/api/v1';
  }

  protected override getExtraHeaders(): Record<string, string> {
    return {
      'HTTP-Referer': 'https://github.com/persian-bot',
      'X-Title': 'Persian-Bot',
    };
  }

  protected override buildBody(req: ChatCompletionRequest): unknown {
    return {
      ...req,
      // Middle-out compression keeps long conversations inside context.
      transforms: ['middle-out'],
    };
  }
}

export function createOpenRouter(apiKey: string): OpenRouterProvider {
  return new OpenRouterProvider({ apiKey });
}

// ── DeepInfra ────────────────────────────────────────────────────────────────

export class DeepInfraProvider extends BaseProvider {
  readonly name = 'deepinfra';
  readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super({ maxRetries: 2, timeout: 60_000, ...config });
    this.baseUrl = config.baseUrl ?? 'https://api.deepinfra.com/v1/openai';
  }
}

export function createDeepInfra(apiKey: string): DeepInfraProvider {
  return new DeepInfraProvider({ apiKey });
}

// ── Venice ───────────────────────────────────────────────────────────────────

export class VeniceProvider extends BaseProvider {
  readonly name = 'venice';
  readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super({ maxRetries: 2, timeout: 60_000, ...config });
    this.baseUrl = config.baseUrl ?? 'https://api.venice.ai/api/v1';
  }
}

export function createVenice(apiKey: string): VeniceProvider {
  return new VeniceProvider({ apiKey });
}

// ── OpenAI-compatible (generic) ────────────────────────────────────────────

export class OpenAICompatProvider extends BaseProvider {
  readonly name: string;
  readonly baseUrl: string;

  constructor(name: string, config: ProviderConfig) {
    super({ maxRetries: 2, timeout: 60_000, ...config });
    this.name = name;
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
  }

  /**
   * Ollama's OpenAI-compat surface does not always serve /v1/models —
   * fall back to its native /api/tags listing (same host, minus the /v1).
   */
  override async listModels(): Promise<string[]> {
    try {
      return await super.listModels();
    } catch (err) {
      if (this.name !== 'ollama') {
        throw new Error((err as Error)?.message ?? 'Model listing failed', { cause: err });
      }
      return this.listOllamaTags();
    }
  }

  private async listOllamaTags(): Promise<string[]> {
    const tagsUrl = `${this.baseUrl.replace(/\/v1\/?$/, '')}/api/tags`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(tagsUrl, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`ollama tags request failed with status ${res.status}`);
      }
      const data = (await res.json()) as { models?: Array<{ name?: string }> };
      return [
        ...new Set(
          (data?.models ?? [])
            .map((m) => m?.name)
            .filter((n): n is string => typeof n === 'string' && n.length > 0),
        ),
      ];
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createOpenAI(apiKey: string): OpenAICompatProvider {
  return new OpenAICompatProvider('openai', {
    apiKey,
    baseUrl: 'https://api.openai.com/v1',
  });
}

export function createTogether(apiKey: string): OpenAICompatProvider {
  return new OpenAICompatProvider('together', {
    apiKey,
    baseUrl: 'https://api.together.xyz/v1',
  });
}

export function createFireworks(apiKey: string): OpenAICompatProvider {
  return new OpenAICompatProvider('fireworks', {
    apiKey,
    baseUrl: 'https://api.fireworks.ai/inference/v1',
  });
}

export function createLepton(apiKey: string): OpenAICompatProvider {
  return new OpenAICompatProvider('lepton', {
    apiKey,
    baseUrl: 'https://api.lepton.ai/api/v1',
  });
}

export function createOllama(baseUrl = 'http://localhost:11434/v1'): OpenAICompatProvider {
  return new OpenAICompatProvider('ollama', { apiKey: 'ollama', baseUrl });
}

export function createLMStudio(baseUrl = 'http://localhost:1234/v1'): OpenAICompatProvider {
  return new OpenAICompatProvider('lmstudio', { apiKey: 'lm-studio', baseUrl });
}

/** Generic factory — any name + baseUrl + apiKey. */
export function createCustomProvider(
  name: string,
  baseUrl: string,
  apiKey: string,
): OpenAICompatProvider {
  return new OpenAICompatProvider(name, { apiKey, baseUrl });
}
