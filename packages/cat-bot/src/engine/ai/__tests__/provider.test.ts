import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GroqProvider, OpenRouterProvider, OpenAICompatProvider } from '../provider/providers.js';
import {
  createProvider,
  listProviders,
  registerProvider,
  chatWithFallback,
  createProviderChain,
} from '../provider/index.js';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as Response;
}

function completion(text: string): unknown {
  return {
    id: 'x',
    object: 'chat.completion',
    created: 1,
    model: 'm',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  };
}

const req = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }] };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BaseProvider transport', () => {
  it('returns completions on success', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(completion('hello')));
    const p = new GroqProvider({ apiKey: 'k', maxRetries: 0, timeout: 5000 });
    const res = await p.chat(req);
    expect(res.choices[0]?.message.content).toBe('hello');
    expect(res.provider).toBe('groq');
  });

  it('retries 502 then succeeds', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse('bad', 502)).mockResolvedValueOnce(jsonResponse(completion('ok')));
    const p = new GroqProvider({ apiKey: 'k', maxRetries: 2, timeout: 5000 });
    const res = await p.chat(req);
    expect(res.choices[0]?.message.content).toBe('ok');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('honours Retry-After on 429', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse('limited', 429, { 'retry-after': '0' })).mockResolvedValueOnce(
      jsonResponse(completion('recovered')),
    );
    const p = new GroqProvider({ apiKey: 'k', maxRetries: 2, timeout: 5000 });
    const res = await p.chat(req);
    expect(res.choices[0]?.message.content).toBe('recovered');
  });

  it('skips 429 retry when retryRateLimit is false', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse('limited', 429));
    const p = new GroqProvider({ apiKey: 'k', maxRetries: 2, timeout: 5000, retryRateLimit: false });
    await expect(p.chat(req)).rejects.toThrow('429');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('treats embedded 200-errors as failures (rate-limit rotation)', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(jsonResponse({ error: { code: 429, message: 'rate limited' } }, 200));
    const p = new OpenRouterProvider({ apiKey: 'k', maxRetries: 1, timeout: 5000 });
    await expect(p.chat(req)).rejects.toThrow('429');
  });

  it('rejects empty choice lists as upstream errors', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ choices: [] }));
    const p = new GroqProvider({ apiKey: 'k', maxRetries: 0, timeout: 5000 });
    await expect(p.chat(req)).rejects.toThrow('no choices');
  });

  it('retries network failures', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(
      jsonResponse(completion('back')),
    );
    const p = new GroqProvider({ apiKey: 'k', maxRetries: 2, timeout: 5000 });
    const res = await p.chat(req);
    expect(res.choices[0]?.message.content).toBe('back');
  });

  it('reports timeouts without hanging', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_url: unknown, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            const e = new Error('aborted') as Error & { name: string };
            e.name = 'AbortError';
            reject(e);
          });
        }),
    );
    const p = new GroqProvider({ apiKey: 'k', maxRetries: 0, timeout: 50 });
    await expect(p.chat(req)).rejects.toThrow('timed out');
  });

  it('does not retry 401 credentials', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(jsonResponse('bad key', 401));
    const p = new GroqProvider({ apiKey: 'bad', maxRetries: 3, timeout: 5000 });
    await expect(p.chat(req)).rejects.toThrow('401');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('provider registry', () => {
  it('lists the conceptual provider set', () => {
    const names = listProviders();
    for (const n of ['groq', 'openrouter', 'deepinfra', 'venice', 'openai', 'together', 'fireworks', 'lepton', 'ollama', 'lmstudio']) {
      expect(names).toContain(n);
    }
  });

  it('creates providers with custom endpoints', () => {
    const p = createProvider('openai', { apiKey: 'k', baseUrl: 'https://custom/v1' });
    expect((p as OpenAICompatProvider).baseUrl).toBe('https://custom/v1');
  });

  it('supports custom registration', () => {
    registerProvider('acme-test', (c) => new OpenAICompatProvider('acme-test', { ...c, baseUrl: 'https://acme/v1' }));
    expect(createProvider('acme-test', { apiKey: 'k' }).name).toBe('acme-test');
  });

  it('rejects unknown providers', () => {
    expect(() => createProvider('nope-missing', { apiKey: 'k' })).toThrow('Unknown provider');
  });

  it('chatWithFallback tries providers in order', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse('down', 503)).mockResolvedValueOnce(jsonResponse(completion('via-fallback')));
    const primary = new GroqProvider({ apiKey: 'k', maxRetries: 0, timeout: 5000 });
    const fallback = new GroqProvider({ apiKey: 'k2', maxRetries: 0, timeout: 5000 });
    const chain = createProviderChain(primary, fallback);
    const res = await chatWithFallback(chain, req);
    expect(res.choices[0]?.message.content).toBe('via-fallback');
  });

  it('createProviderChain requires a configured provider', () => {
    expect(() => createProviderChain(new GroqProvider({ apiKey: '' }))).toThrow();
  });
});
