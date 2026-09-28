import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './mock-database.js';
import { resetDbStubs } from './mock-database.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';
import {
  checkHealth,
  clearProbeCacheForTests,
  completeTurn,
  NeedleClientError,
  normalizeBaseUrl,
  parseTurnResult,
  probeConnection,
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
  token: 'secret-key',
  timeoutMs: 30000,
  maxNewTokens: 256,
  confidenceThreshold: 0.7,
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

/** Exact structured response verified against the live Render service. */
const VERIFIED_RENDER_RESPONSE = {
  type: 'call',
  success: true,
  error: null,
  error_code: null,
  function_calls: [{ name: 'set_brightness', arguments: { brightness: 30 } }],
  suppressed_calls: [],
  reasoning: "brightness 30 from '30'",
  confidence: 1.0,
  prefill_tps: 0.8,
  decode_tps: 0.3,
  peak_ram_mb: 142.8,
  validation: { ungrounded: [], negation: false },
};

describe('needle-client (Wataru /v1/complete contract)', () => {
  beforeEach(() => {
    lruCache.clear();
    clearProbeCacheForTests();
    vi.clearAllMocks();
    resetDbStubs();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['NEEDLE_ENABLED'];
    delete process.env['NEEDLE_URL'];
    delete process.env['NEEDLE_API_KEY'];
    delete process.env['NEEDLE_AUTH_TOKEN'];
    delete process.env['NEEDLE_TIMEOUT_MS'];
    delete process.env['NEEDLE_MAX_NEW_TOKENS'];
  });

  function mockFetch() {
    return vi.mocked(fetch);
  }

  it('normalizes the base URL without appending an endpoint', () => {
    expect(normalizeBaseUrl('https://x.onrender.com/')).toBe('https://x.onrender.com');
    expect(normalizeBaseUrl('https://x.onrender.com///')).toBe('https://x.onrender.com');
    expect(normalizeBaseUrl('  https://x.onrender.com  ')).toBe('https://x.onrender.com');
  });

  it('resolves NEEDLE_API_KEY with legacy NEEDLE_AUTH_TOKEN fallback', async () => {
    process.env['NEEDLE_ENABLED'] = 'true';
    process.env['NEEDLE_URL'] = 'https://env-needle.example/';
    process.env['NEEDLE_API_KEY'] = 'new-key';
    process.env['NEEDLE_AUTH_TOKEN'] = 'old-key';
    const cfg = await resolveNeedleConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.url).toBe('https://env-needle.example');
    expect(cfg.token).toBe('new-key');
    expect(cfg.authMode).toBe('token');
    expect(cfg.timeoutMs).toBe(30000);
    expect(cfg.maxNewTokens).toBe(256);

    delete process.env['NEEDLE_API_KEY'];
    lruCache.clear();
    const legacy = await resolveNeedleConfig();
    expect(legacy.token).toBe('old-key');
    expect(legacy.authMode).toBe('token');
  });

  it('clamps timeout and max tokens into the supported ranges', async () => {
    process.env['NEEDLE_ENABLED'] = 'true';
    process.env['NEEDLE_URL'] = 'https://env-needle.example';
    process.env['NEEDLE_TIMEOUT_MS'] = '999999';
    process.env['NEEDLE_MAX_NEW_TOKENS'] = '9999';
    const cfg = await resolveNeedleConfig();
    expect(cfg.timeoutMs).toBe(120000);
    expect(cfg.maxNewTokens).toBe(512);
  });

  it('parses the verified live response: set_brightness({brightness: 30})', async () => {
    mockFetch().mockResolvedValue(
      jsonResponse(200, VERIFIED_RENDER_RESPONSE) as unknown as Response,
    );
    const { turn, latencyMs } = await completeTurn({
      query: 'set brightness to 30',
      system: 'You are the tool-selection agent.',
      tools: [
        {
          name: 'set_brightness',
          description: 'Set the brightness.',
          parameters: {
            type: 'object',
            properties: { brightness: { type: 'integer' } },
            required: ['brightness'],
          },
        },
      ],
      config: BASE_CONFIG,
    });
    expect(turn.type).toBe('call');
    expect(turn.success).toBe(true);
    expect(turn.functionCalls).toHaveLength(1);
    expect(turn.functionCalls[0]?.name).toBe('set_brightness');
    expect(turn.functionCalls[0]?.arguments).toEqual({ brightness: 30 });
    expect(turn.confidence).toBe(1.0);
    expect(turn.reasoning).toBe("brightness 30 from '30'");
    expect(latencyMs).toBeGreaterThanOrEqual(0);

    const [calledUrl, opts] = mockFetch().mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://needle.example/v1/complete');
    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret-key');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body['query']).toBe('set brightness to 30');
    expect(body['system']).toBe('You are the tool-selection agent.');
    expect(body['max_new_tokens']).toBe(256);
    expect(body).not.toHaveProperty('api_key');
    expect(body).not.toHaveProperty('session_id');
  });

  it('supports multiple function calls in one turn', () => {
    const turn = parseTurnResult({
      type: 'call',
      success: true,
      function_calls: [
        { name: 'first_tool', arguments: {} },
        { name: 'second_tool', arguments: { n: 2 } },
      ],
    });
    expect(turn.functionCalls).toHaveLength(2);
    expect(turn.functionCalls[1]).toEqual({ name: 'second_tool', arguments: { n: 2 } });
  });

  it('treats empty function_calls as refusal (no invented action)', async () => {
    mockFetch().mockResolvedValue(
      jsonResponse(200, { type: 'respond', success: true, function_calls: [] }) as unknown as Response,
    );
    const { turn } = await completeTurn({ query: 'nonsense', tools: TOOLS, config: BASE_CONFIG });
    expect(turn.functionCalls).toEqual([]);
  });

  it('rejects an empty query before any network call', async () => {
    await expect(
      completeTurn({ query: '   ', tools: TOOLS, config: BASE_CONFIG }),
    ).rejects.toMatchObject({ code: 'INVALID' });
    expect(mockFetch()).not.toHaveBeenCalled();
  });

  it('maps a 200 {"error"} body to NEEDLE_ERROR', async () => {
    mockFetch().mockResolvedValue(
      jsonResponse(200, { error: 'engine exploded' }) as unknown as Response,
    );
    await expect(
      completeTurn({ query: 'x', tools: TOOLS, config: BASE_CONFIG }),
    ).rejects.toMatchObject({ code: 'NEEDLE_ERROR' });
  });

  it('maps 401 to UNAUTHORIZED without retrying', async () => {
    mockFetch().mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }) as unknown as Response);
    await expect(
      completeTurn({ query: 'x', tools: TOOLS, config: BASE_CONFIG }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mockFetch()).toHaveBeenCalledTimes(1);
  });

  it('maps 503 (cold start / degraded) to SERVICE_UNAVAILABLE', async () => {
    mockFetch().mockResolvedValue(jsonResponse(503, { ok: false }) as unknown as Response);
    await expect(
      checkHealth(BASE_CONFIG),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('distinguishes DNS, refused, 404, timeout and 500 failures', async () => {
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

    const abort = new Error('aborted');
    abort.name = 'AbortError';
    mockFetch().mockRejectedValueOnce(abort);
    await expect(
      completeTurn({ query: 'x', tools: TOOLS, config: BASE_CONFIG }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    // Timeouts are never retried.
    expect(mockFetch()).toHaveBeenCalledTimes(4);

    // 500 gets exactly one retry, then succeeds.
    mockFetch()
      .mockResolvedValueOnce(jsonResponse(500, {}) as unknown as Response)
      .mockResolvedValueOnce(
        jsonResponse(200, { type: 'respond', success: true, function_calls: [] }) as unknown as Response,
      );
    const { turn } = await completeTurn({ query: 'x', tools: TOOLS, config: BASE_CONFIG });
    expect(turn.type).toBe('respond');
    expect(mockFetch()).toHaveBeenCalledTimes(6);
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

  it('checks health via GET /health asserting needle3 / generation 3', async () => {
    mockFetch().mockResolvedValue(
      jsonResponse(200, { ok: true, model: 'needle3', generation: 3, package_version: '3.0.1' }) as unknown as Response,
    );
    const { health } = await checkHealth(BASE_CONFIG);
    expect(health).toMatchObject({ ok: true, model: 'needle3', generation: 3 });
    const [calledUrl] = mockFetch().mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://needle.example/health');

    mockFetch().mockResolvedValue(
      jsonResponse(200, { ok: true, model: 'other', generation: 2 }) as unknown as Response,
    );
    await expect(checkHealth(BASE_CONFIG)).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('probeConnection connects only after a real /v1/complete', async () => {
    mockFetch()
      .mockResolvedValueOnce(
        jsonResponse(200, { ok: true, model: 'needle3', generation: 3, package_version: '3.0.1' }) as unknown as Response,
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { type: 'call', success: true, function_calls: [] }) as unknown as Response,
      );
    const probe = await probeConnection({ config: BASE_CONFIG, bypassCache: true });
    expect(probe.status).toBe('Connected');
    expect(probe.model).toBe('needle3');
    expect(probe.endpoint).toBe('/v1/complete');
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

  it('probeConnection reports wrong credentials as Unauthorized', async () => {
    mockFetch()
      .mockResolvedValueOnce(
        jsonResponse(200, { ok: true, model: 'needle3', generation: 3 }) as unknown as Response,
      )
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }) as unknown as Response);
    const probe = await probeConnection({ config: BASE_CONFIG, bypassCache: true });
    expect(probe.status).toBe('Unauthorized');
  });

  it('NeedleClientError carries codes', () => {
    expect(new NeedleClientError('TIMEOUT', 't').code).toBe('TIMEOUT');
  });
});
