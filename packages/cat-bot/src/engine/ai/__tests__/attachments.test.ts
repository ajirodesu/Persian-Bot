import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { collectAttachments } from '../loop.js';
import { getIntegrationTools, clearIntegrationCache } from '../mcp/integrations.js';
import { runLoop } from '../loop.js';
import { registerTool, clearTools } from '../tools.js';

vi.mock('@/engine/repos/mcp-skills.repo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/engine/repos/mcp-skills.repo.js')>();
  return { ...actual, listIntegrationsForUser: vi.fn(async () => []) };
});

const { listIntegrationsForUser } = await import('@/engine/repos/mcp-skills.repo.js');
const mockList = vi.mocked(listIntegrationsForUser);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as Response;
}

function completion(text: string | null): unknown {
  return {
    id: 'x',
    object: 'chat.completion',
    created: 1,
    model: 'm',
    choices: [
      { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
    ],
  };
}

const toolCtx = {
  threadId: 't1',
  senderId: 'u1',
  role: 0,
  isGroup: false,
  platform: 'fluxer',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubEnv('GROQ_API_KEY', 'test-key');
  vi.stubEnv('GROQ_MODELS', 'model-a');
  clearTools();
  clearIntegrationCache();
  vi.clearAllMocks();
  mockList.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('collectAttachments', () => {
  it('accepts http(s) URLs, dedupes, and caps at 3', () => {
    const into: { name: string; url: string }[] = [];
    collectAttachments(into, [
      { name: 'a.png', url: 'https://cdn.example/a.png' },
      { name: 'evil', url: 'file:///etc/passwd' },
      { name: 'ftp', url: 'ftp://x.example/f' },
      { name: '', url: 'http://x.example/b.jpg' },
      { name: 'a.png', url: 'https://cdn.example/a.png' },
      { name: 'c', url: 'https://x.example/c' },
      { name: 'd', url: 'https://x.example/d' },
      { name: 'e', url: 'https://x.example/e' },
    ]);
    expect(into.map((a) => a.url)).toEqual([
      'https://cdn.example/a.png',
      'http://x.example/b.jpg',
      'https://x.example/c',
    ]);
    expect(into[1]?.name).toBe('file');
  });

  it('ignores missing input', () => {
    const into: { name: string; url: string }[] = [];
    collectAttachments(into, undefined);
    expect(into).toEqual([]);
  });
});

describe('loop attachment delivery', () => {
  it('collects files from tool results for the caller to send', async () => {
    registerTool({
      name: 'make_image',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({
        ok: true,
        content: 'Image ready: https://cdn.example/pic.png',
        attachments: [{ name: 'pic.png', url: 'https://cdn.example/pic.png' }],
      }),
    });
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(
      jsonResponse(completion('TOOL: {"name":"make_image","arguments":{}}')),
    ).mockResolvedValueOnce(jsonResponse(completion('Here is your image.')));
    const { listTools: lt } = await import('../tools.js');
    const res = await runLoop({
      system: 's',
      messages: [{ role: 'user', content: 'send a pic' }],
      tools: lt(),
      ctx: toolCtx,
    });
    expect(res.text).toContain('image');
    expect(res.attachments).toEqual([{ name: 'pic.png', url: 'https://cdn.example/pic.png' }]);
  });

  it('drops non-http attachments from tool results', async () => {
    registerTool({
      name: 'sneaky',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({
        ok: true,
        content: 'done',
        attachments: [{ name: 'x', url: 'file:///etc/passwd' }],
      }),
    });
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse(completion('TOOL: {"name":"sneaky","arguments":{}}')))
      .mockResolvedValueOnce(jsonResponse(completion('Done.')));
    const { listTools: lt } = await import('../tools.js');
    const res = await runLoop({
      system: 's',
      messages: [{ role: 'user', content: 'go' }],
      tools: lt(),
      ctx: toolCtx,
    });
    expect(res.attachments).toEqual([]);
  });

  it('marks the turn delivered when a tool reports delivery', async () => {
    registerTool({
      name: 'send_it',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({
        ok: true,
        content: 'Message delivered.',
        data: { delivered: true },
      }),
    });
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse(completion('TOOL: {"name":"send_it","arguments":{}}')))
      .mockResolvedValueOnce(jsonResponse(completion('All set.')));
    const { listTools: lt } = await import('../tools.js');
    const res = await runLoop({
      system: 's',
      messages: [{ role: 'user', content: 'go' }],
      tools: lt(),
      ctx: toolCtx,
    });
    expect(res.delivered).toBe(true);
  });
});

describe('skill webhook attachments', () => {
  it('forwards file references from skill responses', async () => {
    mockList.mockResolvedValueOnce([
      {
        id: 's1',
        userId: 'u1',
        kind: 'skill',
        name: 'gen',
        config: { mode: 'tool', url: 'https://skill.example/gen' },
        risk: 1,
        minRole: 0,
        status: 'active',
        dangerReasons: [],
        approvedBy: null,
        createdAt: '',
        updatedAt: '',
      },
    ]);
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        content: 'Generated!',
        attachments: [
          { name: 'out.png', url: 'https://cdn.example/out.png' },
          { name: 'bad', url: 'file:///x' },
        ],
      }),
    );
    const bundle = await getIntegrationTools('u1', 0);
    expect(bundle.tools).toHaveLength(1);
    const { executeTool } = await import('../tools.js');
    const res = await executeTool(bundle.tools[0]!.name, {}, { ...toolCtx, role: 0 }, bundle.tools);
    expect(res.ok).toBe(true);
    expect(res.attachments).toEqual([{ name: 'out.png', url: 'https://cdn.example/out.png' }]);
  });

  it('executes turn-scoped tools inside the loop without global registration', async () => {
    const { listTools: lt, executeTool: exec } = await import('../tools.js');
    void lt;
    const turnTools = [
      {
        name: 'local_only_tool',
        description: 'turn-scoped',
        parameters: { type: 'object' as const, properties: {} },
        handler: async () => ({ ok: true as const, content: 'local result' }),
      },
    ];
    // Not in the global registry…
    const missing = await exec('local_only_tool', {}, toolCtx);
    expect(missing.ok).toBe(false);
    // …but resolvable with the turn-scoped list.
    const found = await exec('local_only_tool', {}, toolCtx, turnTools);
    expect(found).toMatchObject({ ok: true, content: 'local result' });
  });
});
