/**
 * Base Provider — shared HTTP transport with retry/backoff for all providers.
 *
 * Retries 429/502/503/504 with exponential backoff, honours `Retry-After`,
 * converts embedded 200-with-error bodies into real errors, and never lets a
 * hung upstream hold the bot forever (AbortController timeout).
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

import type {
  Provider,
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from './types.js';

export abstract class BaseProvider implements Provider {
  abstract readonly name: string;
  abstract readonly baseUrl: string;

  protected config: ProviderConfig;
  protected maxRetries: number;
  protected timeout: number;
  protected retryRateLimit: boolean;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.maxRetries = config.maxRetries ?? 2;
    this.timeout = config.timeout ?? 30_000;
    this.retryRateLimit = config.retryRateLimit ?? true;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.config.apiKey.length > 0);
  }

  /**
   * Live model ids via GET {baseUrl}/models (OpenAI-compatible).
   * Throws when the provider does not expose a models endpoint — callers
   * convert that into an "unavailable" notice, never a crash.
   */
  async listModels(): Promise<string[]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/models`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, {
        headers: {
          ...this.getAuthHeaders(),
          ...this.getExtraHeaders(),
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`${this.name} models request failed with status ${res.status}`);
      }
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      const ids = (data?.data ?? [])
        .map((m) => m?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      return [...new Set(ids)];
    } finally {
      clearTimeout(timer);
    }
  }

  async chat(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.getAuthHeaders(),
      ...this.getExtraHeaders(),
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(), this.timeout);

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(this.buildBody(req)),
          signal: controller.signal,
        });

        if (timer) clearTimeout(timer);

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const err = new Error(
            `${this.name} API error ${res.status}: ${body.slice(0, 500)}`,
          ) as Error & { status?: number; body?: string };
          err.status = res.status;
          err.body = body;

          const rateLimited = res.status === 429;
          if (
            [429, 502, 503, 504].includes(res.status) &&
            attempt < this.maxRetries &&
            !(rateLimited && !this.retryRateLimit)
          ) {
            const retryAfter = res.headers.get('retry-after');
            const parsed = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : Number.NaN;
            const delay = Number.isFinite(parsed)
              ? Math.min(parsed, 30_000)
              : Math.min(1000 * 2 ** attempt, 10_000);
            await this.sleep(delay);
            continue;
          }

          throw err;
        }

        const data = (await res.json()) as ChatCompletionResponse & {
          error?: { code?: number | string; message?: string; type?: string } | string;
        };

        // Some gateways answer 200 with an error object in the body when an
        // upstream model is rate-limited or unavailable. Treat it as an error
        // so the runner rotates models instead of seeing an empty completion.
        const embedded = this.readEmbeddedError(data);
        if (embedded) throw embedded;

        if (!Array.isArray(data.choices) || data.choices.length === 0) {
          const err = new Error(`${this.name} returned no choices`) as Error & {
            status?: number;
          };
          err.status = 502;
          throw err;
        }

        data.provider = this.name;
        return data;
      } catch (err) {
        if (timer) clearTimeout(timer);
        const typed = err as Error & { name?: string; status?: number; code?: string };
        lastError = typed;

        if (typed.name === 'AbortError') {
          throw new Error(`${this.name} request timed out after ${this.timeout}ms`, { cause: err });
        }

        if (attempt < this.maxRetries && this.isRetryable(typed)) {
          await this.sleep(Math.min(1000 * 2 ** attempt, 10_000));
          continue;
        }

        // Reaching here means no more retries: wrap with cause (lint:
        // preserve-caught-error) while keeping the status classifier intact.
        const failure = new Error(typed?.message ?? `${this.name} request failed`, { cause: err });
        if (typed?.status !== undefined) {
          (failure as Error & { status?: number }).status = typed.status;
        }
        throw failure;
      }
    }

    throw lastError ?? new Error(`${this.name}: all retries exhausted`);
  }

  protected readEmbeddedError(data: {
    error?: { code?: number | string; message?: string } | string;
  }): Error | null {
    const raw = data?.error;
    if (!raw) return null;

    const message = typeof raw === 'string' ? raw : (raw.message ?? 'unknown provider error');
    const code = typeof raw === 'string' ? undefined : raw.code;
    const status = typeof code === 'number' ? code : Number(code);

    const err = new Error(
      `${this.name} API error${Number.isFinite(status) ? ` ${status}` : ''}: ${message.slice(0, 500)}`,
    ) as Error & { status?: number };
    if (Number.isFinite(status)) err.status = status;
    return err;
  }

  protected getAuthHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.apiKey}` };
  }

  /** Provider-specific headers (e.g. OpenRouter referer/title). */
  protected getExtraHeaders(): Record<string, string> {
    return {};
  }

  /** Hook for provider-specific request-body tweaks. */
  protected buildBody(req: ChatCompletionRequest): unknown {
    return req;
  }

  protected isRetryable(err: { status?: number; code?: string; name?: string; message?: string }): boolean {
    if (err?.status === 429) return this.retryRateLimit;
    if (err?.status !== undefined && [502, 503, 504].includes(err.status)) return true;
    if (err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT') return true;
    if (err?.name === 'TypeError' && (err?.message ?? '').includes('fetch')) return true;
    return false;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
