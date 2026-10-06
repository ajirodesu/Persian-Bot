import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveAgentConfig,
  buildCandidates,
  resetProviderCache,
  describeRouting,
} from '../config.js';
import { askAgentText, askAgentJSON, askAgentRaw, AgentError } from '../runner.js';
import { runLoop } from '../loop.js';
import { registerTool, clearTools } from '../tools.js';
import type { ChatMessage } from '../provider/types.js';

function completion(text: string | null, toolCalls?: ChatMessage['tool_calls']): unknown {
  return {
    id: 'x',
    object: 'chat.completion',
    created: 1,
    model: 'm',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls ? 'tool_calls' : 'stop',
      },
    ],
  };
}

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
  vi.stubEnv('GROQ_API_KEY', 'test-key');
  vi.stubEnv('GROQ_MODELS', 'model-a,model-b');
  resetProviderCache();
  clearTools();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetProviderCache();
});

describe('agent config', () => {
  it('resolves built-in defaults', () => {
    const cfg = resolveAgentConfig('default');
    expect(cfg.temperature).toBe(0.3);
    expect(cfg.maxTokens).toBe(1024);
  });

  it('builds rotation candidates from env models', () => {
    const candidates = buildCandidates(resolveAgentConfig('default'));
    expect(candidates.map((c) => c.model)).toEqual(['model-a', 'model-b']);
    expect(candidates[0]?.provider).toBe('groq');
  });

  it('has no candidates without keys', () => {
    vi.stubEnv('GROQ_API_KEY', '');
    resetProviderCache();
    expect(buildCandidates(resolveAgentConfig('nope-agent-xyz'))).toEqual([]);
  });

  it('describeRouting covers the standard agents', () => {
    const routing = describeRouting();
    for (const a of ['default', 'moderator', 'moderator2', 'policy', 'editor']) {
      expect(routing[a]).toBeDefined();
    }
  });
});

describe('askAgentRaw fallback', () => {
  it('rotates models on 429', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse('limited', 429)).mockResolvedValueOnce(
      jsonResponse(completion('second model wins')),
    );
    const res = await askAgentText('default', { system: 's', user: 'hi' });
    expect(res.data).toBe('second model wins');
    expect(res.attempts).toBe(2);
  });

  it('skips the provider on 401', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'bad');
    resetProviderCache();
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse('bad key', 401)).mockResolvedValueOnce(
      jsonResponse(completion('openrouter fallback')),
    );
    const res = await askAgentText('default', {
      system: 's',
      user: 'hi',
      overrides: { fallback: [{ provider: 'openrouter', model: 'free-model' }] },
    });
    expect(res.data).toBe('openrouter fallback');
  });

  it('throws AgentError when nothing is configured', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    resetProviderCache();
    await expect(askAgentRaw('default', [{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(
      AgentError,
    );
  });

  it('treats tool-only turns as non-empty', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(
        completion(null, [
          { id: 'c1', type: 'function', function: { name: 'get_context', arguments: '{}' } },
        ]),
      ),
    );
    const res = await askAgentRaw('default', [{ role: 'user', content: 'hi' }]);
    expect(res.data.tool_calls).toHaveLength(1);
  });
});

describe('askAgentJSON', () => {
  it('parses fenced JSON and validates', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(completion('```json\n{"action":"allow"}\n```')),
    );
    const res = await askAgentJSON('moderator', { system: 's', user: 'u' }, (raw) => raw as object);
    expect(res.data).toEqual({ action: 'allow' });
  });

  it('repairs malformed output once', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse(completion('{"action": oops')))
      .mockResolvedValueOnce(jsonResponse(completion('{"action":"allow","confidence":0.9}')));
    const res = await askAgentJSON('moderator', { system: 's', user: 'u' }, (raw) => raw as { action: string });
    expect(res.data.action).toBe('allow');
    expect(res.attempts).toBe(2);
  });

  it('falls back to labelled fields for weak models', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse(completion('blah blah')))
      .mockResolvedValueOnce(jsonResponse(completion('still not json')))
      .mockResolvedValueOnce(jsonResponse(completion('ACTION: delete\nCONFIDENCE: 0.8')));
    const res = await askAgentJSON(
      'moderator',
      { system: 's', user: 'u' },
      (raw) => raw as Record<string, string>,
      ['action', 'confidence'],
    );
    expect(res.data).toEqual({ action: 'delete', confidence: '0.8' });
  });

  it('fails safely when structure is unusable', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(completion('no json here at all!!!')),
    );
    await expect(
      askAgentJSON('moderator', { system: 's', user: 'u' }, (raw) => raw as object),
    ).rejects.toBeInstanceOf(AgentError);
  });
});

const toolCtx = {
  threadId: 't1',
  senderId: 'u1',
  role: 0,
  isGroup: false,
  platform: 'fluxer',
  runCommand: async () => true,
};

describe('runLoop', () => {
  it('answers directly with no tools', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(completion('just chatting')),
    );
    const res = await runLoop({ system: 's', messages: [{ role: 'user', content: 'hi' }], ctx: toolCtx });
    expect(res.text).toBe('just chatting');
    expect(res.stopReason).toBe('done');
  });

  it('executes one tool call and continues with the result', async () => {
    registerTool({
      name: 'list_commands',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({ ok: true, content: 'ping, weather' }),
    });
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(
      jsonResponse(completion('TOOL: {"name":"list_commands","arguments":{}}')),
    ).mockResolvedValueOnce(jsonResponse(completion('You have ping and weather.')));
    const res = await runLoop({
      system: 's',
      messages: [{ role: 'user', content: 'what can you do?' }],
      tools: (await import('../tools.js')).listTools(),
      ctx: toolCtx,
    });
    expect(res.text).toContain('ping');
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]?.ok).toBe(true);
  });

  it('chains multiple tool calls', async () => {
    registerTool({
      name: 'list_commands',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({ ok: true, content: 'weather exists' }),
    });
    registerTool({
      name: 'run_command',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({ ok: true, content: 'Ran !weather. Posted.' }),
    });
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse(completion('TOOL: {"name":"list_commands","arguments":{}}')))
      .mockResolvedValueOnce(jsonResponse(completion('TOOL: {"name":"run_command","arguments":{"command":"weather"}}')))
      .mockResolvedValueOnce(jsonResponse(completion('Done — forecast posted.')));
    const { listTools: lt } = await import('../tools.js');
    const res = await runLoop({
      system: 's',
      messages: [{ role: 'user', content: 'weather in Manila?' }],
      tools: lt(),
      ctx: toolCtx,
    });
    expect(res.toolCalls).toHaveLength(2);
    expect(res.text).toContain('Done');
  });

  it('recovers from a failed tool and degrades gracefully', async () => {
    registerTool({
      name: 'run_command',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({ ok: false, content: 'No such command' }),
    });
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse(completion('TOOL: {"name":"run_command","arguments":{}}')))
      .mockResolvedValueOnce(jsonResponse(completion('TOOL: {"name":"run_command","arguments":{}}')))
      .mockResolvedValueOnce(jsonResponse(completion('TOOL: {"name":"run_command","arguments":{}}')))
      .mockResolvedValue(jsonResponse(completion('I could not run that, sorry.')));
    const { listTools: lt } = await import('../tools.js');
    const res = await runLoop({
      system: 's',
      messages: [{ role: 'user', content: 'do it' }],
      tools: lt(),
      ctx: toolCtx,
      maxSteps: 4,
      maxToolErrors: 5,
    });
    expect(['looping', 'degraded', 'done', 'max_steps']).toContain(res.stopReason);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it('disables tools after repeated unknown calls', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse(completion('TOOL: {"name":"ghost_tool","arguments":{}}')))
      .mockResolvedValueOnce(jsonResponse(completion('TOOL: {"name":"ghost_tool","arguments":{}}')))
      .mockResolvedValue(jsonResponse(completion('Plain answer.')));
    registerTool({
      name: 'real_tool',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({ ok: true, content: 'real' }),
    });
    const { listTools: lt } = await import('../tools.js');
    const res = await runLoop({
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tools: lt(),
      ctx: toolCtx,
    });
    expect(res.text).toBe('Plain answer.');
  });

  it('stops at max steps', async () => {
    registerTool({
      name: 'echo_tool',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      handler: async (args, _ctx) => ({ ok: true, content: `got ${JSON.stringify(args)}` }),
    });
    let n = 0;
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      jsonResponse(completion(`TOOL: {"name":"echo_tool","arguments":{"n":${++n}}}`)),
    );
    const { listTools: lt } = await import('../tools.js');
    const res = await runLoop({
      system: 's',
      messages: [{ role: 'user', content: 'go' }],
      tools: lt(),
      ctx: toolCtx,
      maxSteps: 2,
    });
    expect(res.stopReason).toBe('max_steps');
  });

  it('fails safely when every provider rejects credentials', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(jsonResponse('bad key', 401));
    const res = await runLoop({
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      ctx: toolCtx,
    });
    expect(res.stopReason).toBe('error');
    expect(res.error).toBeTruthy();
    expect(res.text).toBe('');
  }, 15000);
});
