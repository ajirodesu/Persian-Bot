/**
 * AI Agent — MCP Tool Bridge
 *
 * Exposes the agent's dynamic tool set over the Model Context Protocol (MCP):
 * a Server implements the MCP `tools/list` + `tools/call` JSON-RPC methods,
 * and a Client connects over an in-process InMemoryTransport. The runner
 * talks ONLY to the MCP client — it lists tool schemas via listTools and
 * executes calls via callTool — so the tool layer is a real MCP server, not a
 * bespoke registry.
 *
 * The raw Server API is used (instead of the higher-level McpServer wrapper)
 * because our tools carry plain JSON Schema objects; the wrapper requires Zod
 * schemas. The wire protocol is identical MCP JSON-RPC.
 *
 * In-process transport is deliberate: the tools need the live bot context
 * (ctx.api, ctx.commands, the per-turn ToolContext), which can't cross a
 * subprocess boundary. In-memory gives the full MCP protocol with zero
 * serialization/IPC overhead, which keeps the agent fast while staying a
 * genuine MCP server that could be re-hosted over stdio or SSE later.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from '../agent-tool.types.js';
import { loadAgentTools } from './agent-tool-loader.lib.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { getExternalMcpToolSet } from './external-mcp.lib.js';

/** The LLM-facing schema for one MCP tool (OpenAI-compatible shape). */
export interface McpToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** The executable surface the agent runner consumes. */
export interface McpToolSet {
  schemas: McpToolSchema[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
}

// The tool roster + schemas are static (loaded once at boot and cached by
// loadAgentTools), so the schema list is built once and reused for every turn.
// Building it requires an MCP listTools round trip — caching skips that entirely
// on the hot path, which keeps per-turn tool-set setup to just the in-process
// server/client pair (no IPC anyway). Worst case the cached list is never stale:
// the tools directory does not change at runtime.
//
// Admin-only tools (meta.adminOnly) are filtered out per turn for senders who
// are not system administrators — the schema cache holds the full roster and
// the filtered view is derived per call, so admin status is never cached.
let cachedSchemas: McpToolSchema[] | null = null;

/**
 * Resolves whether the turn's sender is a registered system administrator.
 * Fail-closed: a missing sender ID or an auth-check error means "not admin".
 */
async function senderIsSystemAdmin(ctx: ToolContext): Promise<boolean> {
  const senderID = (ctx.event['senderID'] as string) ?? '';
  if (!senderID) return false;
  try {
    return await isSystemAdmin(senderID);
  } catch {
    return false;
  }
}

/**
 * Builds a live MCP server + client pair bound to this turn's ToolContext.
 * The server is created fresh per turn so each tool call runs against the
 * current conversation (thread, sender); tool modules themselves are loaded
 * dynamically once and cached.
 */
export async function createMcpToolSet(
  ctx: ToolContext,
): Promise<McpToolSet> {
  const toolModules = await loadAgentTools();

  // Exclusive availability: admin-only tools are only exposed to system
  // administrators. Non-admins never see them in listTools (and callTool
  // would reject them as unknown) — plus each admin tool re-checks the
  // caller's admin status inside initialize as defense in depth.
  const adminOnlyNames = new Set(
    toolModules
      .filter((t) => t.meta.adminOnly === true)
      .map((t) => t.meta.name),
  );
  const isAdmin = await senderIsSystemAdmin(ctx);
  const enabled = isAdmin
    ? toolModules
    : toolModules.filter((t) => !adminOnlyNames.has(t.meta.name));
  const byName = new Map(enabled.map((t) => [t.meta.name, t]));

  if (!cachedSchemas) {
    cachedSchemas = toolModules.map((t) => ({
      name: t.meta.name,
      description: t.meta.description,
      parameters: t.meta.parameters as Record<string, unknown>,
    }));
  }
  const schemas = isAdmin
    ? cachedSchemas
    : cachedSchemas.filter((s) => !adminOnlyNames.has(s.name));

  const server = new Server(
    { name: 'cat-bot-agent', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: enabled.map((t) => ({
      name: t.meta.name,
      description: t.meta.description,
      inputSchema: t.meta.parameters as never,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = byName.get(name);
    if (!tool) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }
    try {
      const text = await tool.initialize(
        (args ?? {}) as Record<string, unknown>,
        ctx,
      );
      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Tool execution error: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        ],
        isError: true,
      };
    }
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'cat-bot-agent-client', version: '1.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  // Internal tools take priority on a name collision — external names are
  // namespaced `<server>_<tool>`, so this never triggers in practice.
  const internalNames = new Set(enabled.map((t) => t.meta.name));
  const internalCallTool = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> => {
    try {
      const res = (await client.callTool({
        name,
        arguments: args,
      })) as {
        content: Array<{ type?: string; text?: unknown }>;
        isError?: boolean;
      };
      const text = res.content
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text as string)
        .join('\n');
      return text || '(tool returned no text)';
    } catch (err) {
      return `Tool call failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  };

  // Custom MCP servers configured by system administrators (Admin dashboard →
  // MCP Servers): connect, list their tools, and append them to this turn's
  // tool set. Connections are cached globally across turns by
  // external-mcp.lib.ts, so the per-turn cost here is just a reconcile.
  const external = await getExternalMcpToolSet();

  return {
    schemas: [...schemas, ...external.schemas],
    callTool: async (name, args) => {
      if (internalNames.has(name)) return internalCallTool(name, args);
      return external.callTool(name, args);
    },
  };
}

/**
 * Pre-warms the internal tool loader + schema cache off the hot path so the
 * first agent turn after boot never pays the dynamic-import cost.
 */
export async function warmupAgentTools(): Promise<void> {
  await loadAgentTools();
}
