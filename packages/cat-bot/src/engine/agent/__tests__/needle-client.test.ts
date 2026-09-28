import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './mock-database.js';
import { dbStubs, resetDbStubs } from './mock-database.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';
import {
  completeTurn,
  fetchCapabilities,
  NeedleClientError,
  resetSession,
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
  token: 'tok',
  timeoutMs: 5000,
  confidenceThreshold: 0.7,
  tokenConfigured: true,
};

function jsonResponse(status: number, data: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

describe('needle-client', () => {
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

  it('resolves config from env when no store exists', async () => {
    process.env['NEEDLE_ENABLED'] = 'true';
    process.env['NEEDLE_URL'] = 'https://env-needle.example/';
    process.env['NEEDLE_AUTH_TOKEN'] = 'envtok';
    try {
      const cfg = await resolveNeedleConfig();
      expect(cfg.enabled).toBe(true);
      expect(cfg.url).toBe('https://env-needle.example');
      expect(cfg.tokenConfigured).toBe(true);
    } finally {
      delete process.env['NEEDLE_ENABLED'];
      delete process.env['NEEDLE_URL'];
      delete process.env['NEEDLE_AUTH_TOKEN'];
    }
  });

  it('prefers the dashboard store over env', async () => {
    dbStubs.getAiAgentConfigStore.mockResolvedValue({
      enabled: true,
      needleUrl: 'https://store.example',
      encryptedToken: '',
      timeoutMs: 9000,
      confidenceThreshold: 0.5,
      updatedAt: 'x',
    });
    const cfg = await resolveNeedleConfig();
    expect(cfg.url).toBe('https://store.example');
    expect(cfg.timeoutMs).toBe(9000);
  });

  it('completes a turn and parses the documented response shape', async () => {
    mockFetch().mockResolvedValue(
      jsonResponse(200, {
        result: {
          type: 'call',
          success: true,
          error: null,
          error_code: null,
          function_calls: [
            { name: 'send_result', arguments: { message: 'hi' } },
          ],
          reasoning: 'r',
          confidence: 0.9,
          suppressed_calls: [],
          validation: null,
        },
      }) as unknown as Response,
    );
    const turn = await completeTurn({
      sessionId: 's1',
      system: 'sys',
      tools: TOOLS,
      input: 'hello',
      config: BASE_CONFIG,
    });
    expect(turn.type).toBe('call');
    expect(turn.functionCalls).toHaveLength(1);
    expect(turn.functionCalls[0]?.arguments).toEqual({ message: 'hi' });
    expect(turn.confidence).toBe(0.9);
    const [, opts] = mockFetch().mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer tok',
    );
  });

  it('treats empty function_calls as refusal (no invented action)', async () => {
    mockFetch().mockResolvedValue(
      jsonResponse(200, {
        result: { type: 'respond', success: true, function_calls: [] },
      }) as unknown as Response,
    );
    const turn = await completeTurn({
      sessionId: 's1',
      system: 'sys',
      tools: TOOLS,
      input: 'nonsense',
      config: BASE_CONFIG,
    });
    expect(turn.functionCalls).toEqual([]);
  });

  it('parses string-encoded arguments and drops unparseable calls', async () => {
    mockFetch().mockResolvedValue(
      jsonResponse(200, {
        result: {
          type: 'call',
          success: true,
          function_calls: [
            { name: 'a', arguments: '{"x":1}' },
            { name: 'b', arguments: '{broken' },
          ],
        },
      }) as unknown as Response,
    );
    const turn = await completeTurn({
      sessionId: 's1',
      system: 'sys',
      tools: TOOLS,
      input: 'x',
      config: BASE_CONFIG,
    });
    expect(turn.functionCalls.map((c) => c.name)).toEqual(['a']);
  });

  it('throws UNAUTHORIZED on 401 without retry', async () => {
    mockFetch().mockResolvedValue(jsonResponse(401, {}) as unknown as Response);
    await expect(
      completeTurn({
        sessionId: 's1',
        system: 'sys',
        tools: TOOLS,
        input: 'x',
        config: BASE_CONFIG,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mockFetch()).toHaveBeenCalledTimes(1);
  });

  it('retries once on 500 then succeeds', async () => {
    mockFetch()
      .mockResolvedValueOnce(jsonResponse(500, {}) as unknown as Response)
      .mockResolvedValueOnce(
        jsonResponse(200, {
          result: { type: 'respond', success: true, function_calls: [] },
        }) as unknown as Response,
      );
    const turn = await completeTurn({
      sessionId: 's1',
      system: 'sys',
      tools: TOOLS,
      input: 'x',
      config: BASE_CONFIG,
    });
    expect(turn.type).toBe('respond');
    expect(mockFetch()).toHaveBeenCalledTimes(2);
  });

  it('throws MALFORMED on garbage responses', async () => {
    mockFetch().mockResolvedValue(
      jsonResponse(200, { nope: true }) as unknown as Response,
    );
    await expect(
      completeTurn({
        sessionId: 's1',
        system: 'sys',
        tools: TOOLS,
        input: 'x',
        config: BASE_CONFIG,
      }),
    ).rejects.toMatchObject({ code: 'MALFORMED' });
  });

  it('throws DISABLED / INCOMPLETE_CONFIG before any network call', async () => {
    await expect(
      completeTurn({
        sessionId: 's1',
        system: 'sys',
        tools: TOOLS,
        input: 'x',
        config: { ...BASE_CONFIG, enabled: false },
      }),
    ).rejects.toMatchObject({ code: 'DISABLED' });
    await expect(
      completeTurn({
        sessionId: 's1',
        system: 'sys',
        tools: TOOLS,
        input: 'x',
        config: { ...BASE_CONFIG, url: '', tokenConfigured: false },
      }),
    ).rejects.toMatchObject({ code: 'INCOMPLETE_CONFIG' });
    expect(mockFetch()).not.toHaveBeenCalled();
  });

  it('detects capabilities truthfully (mcp/skills false)', async () => {
    mockFetch().mockResolvedValue(
      jsonResponse(200, {
        toolCalling: true,
        mcp: false,
        skills: false,
        generation: 3,
        needleVersion: '3.0.1',
        runtimeAvailable: true,
      }) as unknown as Response,
    );
    const { status, capabilities } = await fetchCapabilities(BASE_CONFIG);
    expect(status).toBe('Connected');
    expect(capabilities?.toolCalling).toBe(true);
    expect(capabilities?.mcp).toBe(false);
    expect(capabilities?.skills).toBe(false);
  });

  it('reports Unauthorized / Disabled / Configuration incomplete without faking', async () => {
    mockFetch().mockResolvedValue(jsonResponse(401, {}) as unknown as Response);
    expect((await fetchCapabilities(BASE_CONFIG)).status).toBe('Unauthorized');
    expect(
      (await fetchCapabilities({ ...BASE_CONFIG, enabled: false })).status,
    ).toBe('Disabled');
    expect(
      (
        await fetchCapabilities({
          ...BASE_CONFIG,
          url: '',
          tokenConfigured: false,
        })
      ).status,
    ).toBe('Configuration incomplete');
  });

  it('resetSession is best-effort (never throws)', async () => {
    mockFetch().mockRejectedValue(new Error('down'));
    await expect(resetSession('s1', BASE_CONFIG)).resolves.toBeUndefined();
    expect(true).toBe(true);
  });

  it('NeedleClientError carries codes', () => {
    expect(new NeedleClientError('TIMEOUT', 't').code).toBe('TIMEOUT');
  });
});
