import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './mock-database.js';
import { resetDbStubs } from './mock-database.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';
import {
  completeTurn,
  fetchModelName,
  NeedleClientError,
  normalizeBaseUrl,
  probeConnection,
  resetRemote,
  resolveNeedleConfig,
} from '../lib/needle-client.lib.js';

const TOOLS = [
  {
    name: 'send_result',
    description: 'deliver',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

const BASE_CONFIG = {
  enabled: true,
  url: 'https://needle.example',
  token: '',
  timeoutMs: 5000,
  confidenceThreshold: 0.7,
  tokenConfigured: false,
  authMode: 'none' as const,
};

const TOKEN_CONFIG = {
  ...BASE_CONFIG,
  token: 'tok',
  tokenConfigured: true,
  authMode: 'token' as const,
};

function jsonResponse(status: number, data: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function networkError(code: string) {
  const err = new Error(`fetch failed (${code})`);
  (err as { cause?: unknown }).cause = { code };
  return err;
}

describe('needle-client (playground contract)', () => {
  beforeEach(() => {
    lruCache.clear();
    vi.clearAllMocks();
    resetDbStubs();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch() {
    return vi.mocked(fetch);
  }

  it('normalizes the base URL without appending an endpoint', () => {
    expect(normalizeBaseUrl('https://x.onrender.com/')).toBe('https://x.onrender.com');
    expect(normalizeBaseUrl('https://x.onrender.com///')).toBe('https://x.onrender.com');
    expect(normalizeBaseUrl('  https://x.onrender.com  ')).toBe('https://x.onrender.com');
  });

  it('resolves authMode none when no token is configured', async () => {
    process.env['NEEDLE_ENABLED'] = 'true';
    process.env['NEEDLE_URL'] = 'https://env-needle.example/';
    delete process.env['NEEDLE_AUTH_TOKEN'];
    try {
      const cfg = await resolveNeedleConfig();
      expect(cfg.enabled).toBe(true);
      expect(cfg.url).toBe('https://env-needle.example');
      expect(cfg.authMode).toBe('none');
      expect(cfg.timeoutMs).toBe(300000);
    } finally {
      delete process.env['NEEDLE_ENABLED'];
      delete process.env['NEEDLE_URL'];
    }
  });

  it('POSTs /complete with {query, tools} and no api_key', async () => {
    mockFetch().mockResolvedValue(
      jsonResponse(200, {
        type: 'call',
        success: true,
        error: null,
        error_code: null,
        function_calls: [{ name: 'send_result', arguments: { message: 'hi' } }],
        reasoning: 'r',
        confidence: 0.9,
        suppressed_calls: [],
        validation: null,
      }) as unknown as Response,
    );
    const { turn, latencyMs } = await completeTurn({
      query: 'hello',
      tools: TOOLS,
      config: BASE_CONFIG,
    });
    expect(turn.type).toBe('call');
    expect(turn.functionCalls).toHaveLength(1);
    expect(turn.functionCalls[0]?.arguments).toEqual({ message: 'hi' });
    expect(turn.confidence).toBe(0.9);
    expect(latencyMs).toBeGreaterThanOrEqual(0);
    const [calledUrl, opts] = mockFetch().mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://needle.example/complete');
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['query', 'tools']);
    expect(body).not.toHaveProperty('api_key');
    expect(opts.headers).not.toHaveProperty('Authorization');
  });

  it('sends the Service Token only when configured', async () => {
    mockFetch().mockResolvedValue(
      jsonResponse(200, { type: 'respond', success: true, function_calls: [] }) as unknown as Response,
    );
    await completeTurn({ query: 'x', tools: TOOLS, config: TOKEN_CONFIG });
    const [, opts] = mockFetch().mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('treats empty function_calls as refusal (no invented action)', async () => {
    mockFetch().mockResolvedValue(
      jsonResponse(200, { type: 'respond', success: true, function_calls: [] }) as unknown as Response,
    );
    const { turn } = await completeTurn({ query: 'nonsense', tools: TOOLS, config: BASE_CONFIG });
    expect(turn.functionCalls).toEqual([]);
  });

  it('maps a 200 {"error"} body to NEEDLE_ERROR', async () => {
    mockFetch().mockResolvedValue(
      jsonResponse(200, { error: 'engine exploded' }) as unknown as Response,
    );
    await expect(
      completeTurn({ query: 'x', tools: TOOLS, config: BASE_CONFIG }),
    ).rejects.toMatchObject({ code: 'NEEDLE_ERROR' });
  });

  it('distinguishes DNS, refused, 404, 401 and 500 failures', async () => {
    mockFetch().mockRejectedValueOnce(networkError('ENOTFOUND'));
    await expect(
      completeTurn({ query: 'x', tools: TOOLS, config: BASE_CONFIG }),
    ).rejects.toMatchObject({ code: 'UNRESOLVABLE' });

    mockFetch().mockRejectedValueOnce(networkError('ECONNREFUSED'));
    await expect(
      completeTurn({ query: 'x', tools: TOOLS, config: BASE_CONFIG }),
    ).rejects.toMatchObject({ code: 'REFUSED' });

    mockFetch().mockResolvedValueOnce(jsonResponse(404, 'not found') as unknown as Response);
    await expect(
      completeTurn({ query: 'x', tools: TOOLS, config: BASE_CONFIG }),
    ).rejects.toMatchObject({ code: 'ENDPOINT_NOT_FOUND' });

    mockFetch().mockResolvedValueOnce(jsonResponse(401, {}) as unknown as Response);
    await expect(
      completeTurn({ query: 'x', tools: TOOLS, config: BASE_CONFIG }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mockFetch().mock.calls.length).toBeGreaterThan(0);

    // 401 is never retried.
    const callsBefore = mockFetch().mock.calls.length;
    mockFetch().mockResolvedValueOnce(jsonResponse(401, {}) as unknown as Response);
    await expect(
      completeTurn({ query: 'x', tools: TOOLS, config: BASE_CONFIG }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mockFetch().mock.calls.length).toBe(callsBefore + 1);
  });

  it('retries once on 500 then succeeds', async () => {
    mockFetch()
      .mockResolvedValueOnce(jsonResponse(500, {}) as unknown as Response)
      .mockResolvedValueOnce(
        jsonResponse(200, { type: 'respond', success: true, function_calls: [] }) as unknown as Response,
      );
    const { turn } = await completeTurn({ query: 'x', tools: TOOLS, config: BASE_CONFIG });
    expect(turn.type).toBe('respond');
    expect(mockFetch()).toHaveBeenCalledTimes(2);
  });

  it('throws DISABLED / INCOMPLETE_CONFIG before any network call', async () => {
    await expect(
      completeTurn({ query: 'x', tools: TOOLS, config: { ...BASE_CONFIG, enabled: false } }),
    ).rejects.toMatchObject({ code: 'DISABLED' });
    await expect(
      completeTurn({ query: 'x', tools: TOOLS, config: { ...BASE_CONFIG, url: '' } }),
    ).rejects.toMatchObject({ code: 'INCOMPLETE_CONFIG' });
    expect(mockFetch()).not.toHaveBeenCalled();
  });

  it('fetches the model name from GET /model', async () => {
    mockFetch().mockResolvedValue(
      jsonResponse(200, { name: 'needle3.cact' }) as unknown as Response,
    );
    await expect(fetchModelName(BASE_CONFIG)).resolves.toBe('needle3.cact');
    const [calledUrl] = mockFetch().mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://needle.example/model');
  });

  it('resetRemote POSTs /reset and never throws', async () => {
    mockFetch().mockResolvedValue(jsonResponse(200, { ok: true }) as unknown as Response);
    await expect(resetRemote(BASE_CONFIG)).resolves.toBeUndefined();
    const [calledUrl] = mockFetch().mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://needle.example/reset');
    mockFetch().mockRejectedValue(networkError('ECONNREFUSED'));
    await expect(resetRemote(BASE_CONFIG)).resolves.toBeUndefined();
  });

  it('probeConnection connects only after a real /complete', async () => {
    mockFetch()
      .mockResolvedValueOnce(jsonResponse(200, { name: 'needle3.cact' }) as unknown as Response)
      .mockResolvedValueOnce(
        jsonResponse(200, { type: 'call', success: true, function_calls: [] }) as unknown as Response,
      );
    const probe = await probeConnection({ config: BASE_CONFIG, bypassCache: true });
    expect(probe.status).toBe('Connected');
    expect(probe.model).toBe('needle3.cact');
    expect(probe.endpoint).toBe('/complete');
    expect(probe.capabilities?.toolCalling).toBe(true);
    expect(probe.capabilities?.mcp).toBe(false);
    expect(probe.capabilities?.skills).toBe(false);
    expect(probe.detail).toBeNull();
  });

  it('probeConnection reports unreachable model host distinctly', async () => {
    mockFetch().mockRejectedValue(networkError('ENOTFOUND'));
    const probe = await probeConnection({ config: BASE_CONFIG, bypassCache: true });
    expect(probe.status).toBe('Disconnected');
    expect(probe.detail).toContain('Cannot resolve host');
    expect(probe.capabilities).toBeNull();
  });

  it('probeConnection reports refused /complete distinctly', async () => {
    mockFetch()
      .mockResolvedValueOnce(jsonResponse(200, { name: 'needle3.cact' }) as unknown as Response)
      .mockRejectedValueOnce(networkError('ECONNREFUSED'));
    const probe = await probeConnection({ config: BASE_CONFIG, bypassCache: true });
    expect(probe.status).toBe('Disconnected');
    expect(probe.detail).toContain('Connection refused');
  });

  it('NeedleClientError carries codes', () => {
    expect(new NeedleClientError('TIMEOUT', 't').code).toBe('TIMEOUT');
  });
});
