import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GroqProvider, OpenAICompatProvider } from '../provider/providers.js';
import { listProviderModels } from '../models.js';
import { clearSnapshotsForTests, resetProviderCache } from '../config.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  clearSnapshotsForTests();
  resetProviderCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clearSnapshotsForTests();
  resetProviderCache();
});

describe('provider listModels', () => {
  it('parses the OpenAI models shape and dedupes', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ data: [{ id: 'a' }, { id: 'b' }, { id: 'a' }, {}] }),
    );
    const p = new GroqProvider({ apiKey: 'k', maxRetries: 0, timeout: 5000 });
    expect(await p.listModels()).toEqual(['a', 'b']);
  });

  it('throws when the endpoint errors', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse('denied', 401),
    );
    const p = new GroqProvider({ apiKey: 'bad', maxRetries: 0, timeout: 5000 });
    await expect(p.listModels()).rejects.toThrow('401');
  });

  it('falls back to /api/tags for ollama', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse('nope', 404)).mockResolvedValueOnce(
      jsonResponse({ models: [{ name: 'llama3' }, { name: 'qwen2' }] }),
    );
    const p = new OpenAICompatProvider('ollama', { apiKey: 'ollama', baseUrl: 'http://localhost:11434/v1' });
    expect(await p.listModels()).toEqual(['llama3', 'qwen2']);
    expect(f.mock.calls[1]?.[0]).toContain('/api/tags');
  });

  it('does not fall back for other providers', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse('nope', 404),
    );
    const p = new OpenAICompatProvider('acme', { apiKey: 'k', baseUrl: 'https://acme.example/v1' });
    await expect(p.listModels()).rejects.toThrow('404');
  });
});

describe('listProviderModels', () => {
  it('uses the caller stored key', async () => {
    vi.stubEnv('GROQ_API_KEY', 'env-key');
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ data: [{ id: 'live-model' }] }),
    );
    const res = await listProviderModels('groq');
    expect(res).toEqual({ provider: 'groq', models: ['live-model'] });
  });

  it('rejects unknown providers and missing keys', async () => {
    await expect(listProviderModels('nope')).rejects.toThrow('Unknown provider');
    await expect(listProviderModels('venice')).rejects.toThrow('No API key');
  });
});
