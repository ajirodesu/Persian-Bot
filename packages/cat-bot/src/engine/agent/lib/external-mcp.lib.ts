/**
 * External MCP Connection Manager
 *
 * Connects the agent to custom MCP servers configured by system administrators
 * (Admin dashboard → MCP Servers). Each ENABLED server from the database is
 * connected over MCP Streamable HTTP; its tools are merged into the agent's
 * LLM-facing tool set (namespaced as `<serverName>_<toolName>` so they can
 * never collide with the internal agent tools).
 *
 * Connections are CACHED globally and reused across turns — a fresh
 * HTTP handshake per turn would add unacceptable latency and hammer the
 * servers. Reconcile-on-read keeps the registry in sync with the database:
 * new/changed servers connect, removed/disabled servers disconnect. A server
 * that fails to connect is skipped gracefully (and rate-limited to one retry
 * per 60s) so a dead endpoint never blocks or stalls an agent turn.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpToolSchema, McpToolSet } from './mcp-tools.lib.js';
import {
  listMcpServers,
  type McpServerConfig,
} from '@/engine/repos/mcp-servers.repo.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

const MCP_CONNECT_TIMEOUT_MS = 10_000; // handshake/listTools cap per server
const MCP_TOOL_TIMEOUT_MS = 60_000; // hard cap on one external tool call
const FAILED_RETRY_MS = 60_000; // skip a dead server for 60s before retrying

// StreamableHTTPClientTransport's declared `sessionId: string | undefined`
// conflicts with the Transport interface's optional `sessionId?: string` under
// exactOptionalPropertyTypes — structurally identical at runtime, so cast to
// the exact type connect() expects.
type ConnectableTransport = Parameters<Client['connect']>[0];

interface ExternalMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ConnectedServer {
  config: McpServerConfig;
  client: Client;
  transport: StreamableHTTPClientTransport;
  tools: ExternalMcpTool[];
}

/** id → live connection. */
const registry = new Map<string, ConnectedServer>();
/** id → in-flight connect promise (dedupes concurrent connects). */
const connecting = new Map<string, Promise<ConnectedServer | null>>();
/** id → last failed-attempt timestamp (backoff for dead servers). */
const failedServers = new Map<string, number>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Lowercases + strips to [a-z0-9_-] so tool names are valid on every provider. */
function sanitizeName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'mcp'
  );
}

/** The namespaced LLM-facing name for an external tool. */
export function externalToolName(
  server: Pick<McpServerConfig, 'name'>,
  toolName: string,
): string {
  return `${sanitizeName(server.name)}_${toolName}`;
}

async function connectServer(
  config: McpServerConfig,
): Promise<ConnectedServer | null> {
  let transport: StreamableHTTPClientTransport | undefined;
  try {
    const headers: Record<string, string> = { ...config.headers };
    transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers },
    });
    const client = new Client({ name: 'cat-bot-mcp', version: '1.0.0' });
    await withTimeout(
      client.connect(transport as ConnectableTransport),
      MCP_CONNECT_TIMEOUT_MS,
    );
    const { tools } = await withTimeout(
      client.listTools(),
      MCP_CONNECT_TIMEOUT_MS,
    );
    const normalized: ExternalMcpTool[] = tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema ?? {
        type: 'object',
        properties: {},
      }) as Record<string, unknown>,
    }));
    const connected: ConnectedServer = {
      config,
      client,
      transport,
      tools: normalized,
    };
    registry.set(config.id, connected);
    return connected;
  } catch (err) {
    logger.warn('[ExternalMcp] Failed to connect to server', {
      name: config.name,
      url: config.url,
      error: err instanceof Error ? err.message : String(err),
    });
    if (transport) {
      try {
        await transport.close();
      } catch {
        /* ignore */
      }
    }
    return null;
  }
}

async function disconnect(id: string): Promise<void> {
  const conn = registry.get(id);
  registry.delete(id);
  if (!conn) return;
  try {
    await conn.client.close();
  } catch {
    /* ignore */
  }
  try {
    await conn.transport.close();
  } catch {
    /* ignore */
  }
}

function configChanged(
  conn: ConnectedServer,
  config: McpServerConfig,
): boolean {
  return (
    conn.config.url !== config.url ||
    conn.config.enabled !== config.enabled ||
    JSON.stringify(conn.config.headers) !== JSON.stringify(config.headers)
  );
}

/** Ensures a connection exists for the server, reconnecting when config changed. */
async function ensureConnected(
  config: McpServerConfig,
): Promise<ConnectedServer | null> {
  const existing = registry.get(config.id);
  if (existing) {
    if (!configChanged(existing, config)) return existing;
    await disconnect(config.id);
  }

  // Backoff: don't retry a recently-failed server on every turn.
  const lastFail = failedServers.get(config.id);
  if (lastFail !== undefined && Date.now() - lastFail < FAILED_RETRY_MS) {
    return null;
  }

  const inFlight = connecting.get(config.id);
  if (inFlight) return inFlight;

  const attempt = connectServer(config).then((conn) => {
    if (conn) failedServers.delete(config.id);
    else failedServers.set(config.id, Date.now());
    return conn;
  });
  connecting.set(config.id, attempt);
  try {
    return await attempt;
  } finally {
    connecting.delete(config.id);
  }
}

/**
 * Builds the merged tool set from every enabled external MCP server. Cheap on
 * the hot path: the server list is LRU-cached and live connections are reused,
 * so this is just map lookups + a lightweight reconcile.
 *
 * `roleGate` (optional) filters servers whose role requirement the current
 * sender does not meet — same minimum-role semantics as command meta.role
 * (0 anyone … 4 system admin). Servers excluded by the gate are never
 * connected, never listed, and their tools cannot be called this turn.
 */
export async function getExternalMcpToolSet(
  roleGate?: (server: McpServerConfig) => boolean,
): Promise<McpToolSet> {
  const servers = await listMcpServers();
  const enabled = servers.filter(
    (s) => s.enabled && (!roleGate || roleGate(s)),
  );

  const schemas: McpToolSchema[] = [];
  const byName = new Map<
    string,
    { serverId: string; toolName: string; serverName: string }
  >();

  await Promise.allSettled(
    enabled.map(async (server) => {
      const conn = await ensureConnected(server);
      if (!conn) return;
      for (const tool of conn.tools) {
        const fullName = externalToolName(server, tool.name);
        schemas.push({
          name: fullName,
          description: tool.description ?? '',
          parameters: tool.inputSchema,
        });
        byName.set(fullName, {
          serverId: server.id,
          toolName: tool.name,
          serverName: server.name,
        });
      }
    }),
  );

  // Disconnect servers that were removed or disabled since the last reconcile.
  const activeIds = new Set(enabled.map((s) => s.id));
  for (const id of [...registry.keys()]) {
    if (!activeIds.has(id)) await disconnect(id);
  }

  return {
    schemas,
    callTool: async (name, args) => {
      const target = byName.get(name);
      if (!target) return `Unknown tool: ${name}`;
      const conn = registry.get(target.serverId);
      if (!conn) return `MCP server connection unavailable: ${name}`;
      try {
        const res = (await withTimeout(
          conn.client.callTool({
            name: target.toolName,
            arguments: args,
          }),
          MCP_TOOL_TIMEOUT_MS,
        )) as {
          content?: Array<{ type?: string; text?: unknown }>;
          isError?: boolean;
        };
        const text = (res?.content ?? [])
          .filter((c) => c?.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text as string)
          .join('\n');
        return text || '(tool returned no text)';
      } catch (err) {
        return `Tool call failed: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }
    },
  };
}

/** One-shot connection test for the admin dashboard (never cached). */
export async function testMcpServerConnection(input: {
  url: string;
  headers?: Record<string, string>;
}): Promise<{
  ok: boolean;
  toolCount: number;
  toolNames: string[];
  error?: string;
}> {
  let transport: StreamableHTTPClientTransport | undefined;
  let client: Client | undefined;
  try {
    const headers: Record<string, string> = { ...(input.headers ?? {}) };
    transport = new StreamableHTTPClientTransport(new URL(input.url), {
      requestInit: { headers },
    });
    client = new Client({ name: 'cat-bot-mcp-test', version: '1.0.0' });
    await withTimeout(
      client.connect(transport as ConnectableTransport),
      MCP_CONNECT_TIMEOUT_MS,
    );
    const { tools } = await withTimeout(
      client.listTools(),
      MCP_CONNECT_TIMEOUT_MS,
    );
    return {
      ok: true,
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
    };
  } catch (err) {
    return {
      ok: false,
      toolCount: 0,
      toolNames: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
    if (transport) {
      try {
        await transport.close();
      } catch {
        /* ignore */
      }
    }
  }
}

/** Closes every external connection (used on registry invalidation). */
export async function closeAllExternalMcpConnections(): Promise<void> {
  for (const id of [...registry.keys()]) await disconnect(id);
  failedServers.clear();
}

/** Pre-warms external connections at boot so the first turn is already wired. */
export async function warmupExternalMcpConnections(): Promise<void> {
  try {
    await getExternalMcpToolSet();
    logger.info(
      '[ExternalMcp] Pre-warmed external MCP connections',
    );
  } catch (err) {
    logger.warn('[ExternalMcp] Pre-warm failed (non-fatal)', { error: err });
  }
}