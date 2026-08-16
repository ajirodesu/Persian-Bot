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
import type { ToolContext } from './agent-tool.types.js';
import { loadAgentTools } from './agent-tool-loader.lib.js';

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
  const enabled = toolModules;
  const byName = new Map(enabled.map((t) => [t.meta.name, t]));

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

  const listed = await client.listTools();
  const schemas: McpToolSchema[] = listed.tools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<
      string,
      unknown
    >,
  }));

  return {
    schemas,
    callTool: async (name, args) => {
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
    },
  };
}
