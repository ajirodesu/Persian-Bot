import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listMcpTools, callMcpTool, clearMcpToolCache } from '../mcp/client.js';

function jsonResponse(body: unknown, status = 200, contentType = 'application/json'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': contentType }),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  clearMcpToolCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const URL = 'https://mcp.example.com/rpc';

describe('listMcpTools', () => {
  it('lists tools over JSON-RPC', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 'init-1', result: {} }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 'tools-1',
          result: { tools: [{ name: 'search', description: 'Search docs', inputSchema: { type: 'object' } }] },
        }),
      );
    const tools = await listMcpTools(URL);
    expect(tools).toEqual([
      { name: 'search', description: 'Search docs', inputSchema: { type: 'object' } },
    ]);
  });

  it('parses SSE responses', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', result: {} }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse(
          'event: message\ndata: {"jsonrpc":"2.0","id":"tools-1","result":{"tools":[{"name":"t"}]}}\n\n',
          200,
          'text/event-stream',
        ),
      );
    const tools = await listMcpTools(URL);
    expect(tools.map((t) => t.name)).toEqual(['t']);
  });

  it('throws on RPC errors', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', result: {} }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' } }),
      );
    await expect(listMcpTools(URL)).rejects.toThrow('Method not found');
  });

  it('caches listings per URL', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(jsonResponse({ jsonrpc: '2.0', result: { tools: [] } }));
    await listMcpTools(URL);
    await listMcpTools(URL);
    // init + initialized + tools/list = 3 calls once; second call served from cache.
    expect(f.mock.calls.length).toBe(3);
  });
});

describe('callMcpTool', () => {
  it('returns text content', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', result: {} }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: 'hello' }] } }),
      );
    const res = await callMcpTool(URL, {}, 'search', { q: 'x' });
    expect(res).toMatchObject({ ok: true, content: 'hello' });
  });

  it('converts tool errors to failed observations, never throws', async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', result: {} }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          result: { content: [{ type: 'text', text: 'boom' }], isError: true },
        }),
      );
    const res = await callMcpTool(URL, {}, 'search', {});
    expect(res.ok).toBe(false);
    expect(res.content).toContain('boom');
  });

  it('converts transport failures to observations', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError('fetch failed'),
    );
    const res = await callMcpTool(URL, {}, 'search', {});
    expect(res.ok).toBe(false);
  });
});
