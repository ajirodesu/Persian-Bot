/**
 * Minimal MCP client — Streamable HTTP transport with JSON-RPC 2.0.
 *
 * Speaks to user-added MCP servers: `initialize` → `tools/list` →
 * `tools/call`. Handles both plain-JSON and SSE (`text/event-stream`)
 * responses. Every request is bounded by timeout; failures come back as
 * `{ ok: false }` observations, never throws into the agent loop.
 */

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpResult {
  ok: boolean;
  content: string;
  data?: unknown;
}

const PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 20_000;

interface CacheEntry {
  at: number;
  tools: McpToolDef[];
}

const toolCache = new Map<string, CacheEntry>();
const TOOL_CACHE_TTL_MS = 60_000;

/** Test seam. */
export function clearMcpToolCache(): void {
  toolCache.clear();
}

async function postJsonRpc(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ status: number; payload: unknown; sessionId?: string | undefined }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': PROTOCOL_VERSION,
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...body }),
      signal: controller.signal,
    });
    const sessionId = res.headers.get('mcp-session-id') ?? undefined;
    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return { status: res.status, payload: { error: text.slice(0, 500) }, sessionId };
    }
    if (contentType.includes('text/event-stream')) {
      return { status: res.status, payload: parseSse(text), sessionId };
    }
    try {
      return { status: res.status, payload: JSON.parse(text) as unknown, sessionId };
    } catch {
      return { status: res.status, payload: { error: 'non-JSON response' }, sessionId };
    }
  } catch (err) {
    const typed = err as Error & { name?: string };
    if (typed?.name === 'AbortError') {
      throw new Error(`MCP request timed out after ${timeoutMs}ms`, { cause: err });
    }
    throw new Error(typed?.message ?? 'MCP request failed', { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

/** SSE responses carry one JSON-RPC message per `data:` line — take the last. */
function parseSse(text: string): unknown {
  const messages: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^data:\s*(.*)$/);
    if (!m?.[1] || m[1].trim() === '[DONE]') continue;
    try {
      messages.push(JSON.parse(m[1]) as unknown);
    } catch {
      continue;
    }
  }
  return messages.length > 0 ? messages[messages.length - 1] : { error: 'empty event stream' };
}

function rpcError(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const err = (payload as Record<string, unknown>).error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      return String((err as Record<string, unknown>).message ?? 'MCP error');
    }
  }
  return null;
}

async function initialize(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Record<string, string>> {
  const { payload } = await postJsonRpc(
    url,
    headers,
    {
      id: 'init-1',
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'persian-bot', version: '1.0.0' },
      },
    },
    timeoutMs,
  );
  const err = rpcError(payload);
  if (err) throw new Error(`MCP initialize failed: ${err.slice(0, 200)}`);
  // Best-effort initialized notification — required by strict servers,
  // harmless to servers that accept calls without it.
  try {
    await postJsonRpc(url, headers, { method: 'notifications/initialized' }, timeoutMs);
  } catch {
    /* optional */
  }
  return headers;
}

/**
 * List the tools an MCP server exposes. Results are cached per URL for 60s.
 * Throws on transport errors; the caller converts to observations.
 */
export async function listMcpTools(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<McpToolDef[]> {
  const cacheKey = `${url}|${JSON.stringify(headers)}`;
  const hit = toolCache.get(cacheKey);
  if (hit && Date.now() - hit.at < TOOL_CACHE_TTL_MS) return hit.tools;

  const sessionHeaders = await initialize(url, headers, timeoutMs);
  const { payload } = await postJsonRpc(
    url,
    sessionHeaders,
    { id: 'tools-1', method: 'tools/list', params: {} },
    timeoutMs,
  );
  const err = rpcError(payload);
  if (err) throw new Error(`MCP tools/list failed: ${err.slice(0, 200)}`);

  const tools = (
    ((payload as Record<string, unknown>)?.result as Record<string, unknown> | undefined)
      ?.tools as Array<Record<string, unknown>> | undefined
  ) ?? [];
  const defs: McpToolDef[] = tools
    .filter((t) => typeof t?.name === 'string')
    .map((t) => ({
      name: String(t.name),
      ...(typeof t.description === 'string' ? { description: t.description } : {}),
      ...(t.inputSchema && typeof t.inputSchema === 'object'
        ? { inputSchema: t.inputSchema as Record<string, unknown> }
        : {}),
    }));

  toolCache.set(cacheKey, { at: Date.now(), tools: defs });
  return defs;
}

/** Call one MCP tool. Never throws — failures return `{ ok: false }`. */
export async function callMcpTool(
  url: string,
  headers: Record<string, string>,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<McpResult> {
  try {
    await initialize(url, headers, timeoutMs);
    const { payload } = await postJsonRpc(
      url,
      headers,
      { id: `call-${Date.now()}`, method: 'tools/call', params: { name: toolName, arguments: args } },
      timeoutMs,
    );
    const err = rpcError(payload);
    if (err) return { ok: false, content: `MCP tool "${toolName}" failed: ${err.slice(0, 500)}` };

    const result = (payload as Record<string, unknown>)?.result as
      | { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
      | undefined;
    if (!result) return { ok: true, content: 'MCP tool returned no content.', data: payload };

    const texts = (result.content ?? [])
      .filter((c) => typeof c?.text === 'string')
      .map((c) => String(c.text))
      .join('\n')
      .slice(0, 4000);
    if (result.isError) {
      return { ok: false, content: texts || `MCP tool "${toolName}" reported an error.` };
    }
    return { ok: true, content: texts || 'MCP tool completed with no text output.', data: result };
  } catch (err) {
    return { ok: false, content: `MCP call failed: ${(err as Error)?.message ?? String(err)}` };
  }
}
