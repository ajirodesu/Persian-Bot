import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import type { AgentTool } from './agent.util.js';

/**
 * In-process MCP server exposing the agent's tools over the Model Context
 * Protocol, plus the thin client the agent loop uses to talk to it.
 *
 * WHY THE LOW-LEVEL SERVER (not McpServer.registerTool):
 *   Tool schemas are plain JSON Schema `parameters` carrying provider-specific
 *   quirks (e.g. Groq rejects a bare `type: 'string'` when the model passes
 *   null, so the schemas declare `type: ['string', 'null']`). The SDK's
 *   high-level McpServer validates input through Zod and would force every
 *   schema into a Zod shape. Driving the low-level `Server` directly — with
 *   ListTools/CallTool request handlers — keeps the existing JSON schemas as
 *   the single source of truth end-to-end, and tool args are passed through
 *   unvalidated exactly as today.
 *
 * WHY IN-PROCESS / PER-RUN:
 *   Tools are bound to the live AppCtx (sender/thread/session identity, DB
 *   access, message delivery, per-turn delivery flags). A fresh server + client
 *   pair is created per runAgent and closed over the CURRENT ctx, so no session
 *   state can leak across invocations. The in-memory transport holds no
 *   sockets, timers, or open handles — the pair is garbage-collected once the
 *   agent turn ends, so there is no explicit close() on the session.
 */

/** A tool descriptor as enumerated by the MCP client (tools/list). */
export interface AgentMcpToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** The client-side handle the agent loop uses to reach the tool server. */
export interface AgentMcpSession {
  listTools(): Promise<AgentMcpToolDescriptor[]>;
  /** Runs a tool (tools/call) and returns its text result, verbatim. */
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
}

/**
 * Builds a linked in-process MCP server + client pair serving the given tools.
 * Tool handlers close over `ctx`, so every execution has full AppCtx access.
 */
export async function createAgentMcpSession(
  tools: AgentTool[],
  ctx: AppCtx,
): Promise<AgentMcpSession> {
  const toolMap = new Map(tools.map((t) => [t.config.name, t]));

  const server = new Server(
    { name: 'cat-bot-agent', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.config.name,
      description: t.config.description,
      inputSchema: t.config.parameters,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolMap.get(request.params.name);
    if (!tool) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: Tool '${request.params.name}' not found.`,
          },
        ],
        isError: true,
      };
    }
    try {
      // `arguments` is the parsed JSON the model produced — the same shape the
      // agent previously passed straight to tool.run(). MCP adds no coercion.
      const result = await tool.run(request.params.arguments ?? {}, ctx);
      return { content: [{ type: 'text', text: String(result) }] };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Tool execution error: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        ],
        isError: true,
      };
    }
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'cat-bot-agent-client', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return {
    async listTools() {
      const res = await client.listTools();
      return res.tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        parameters: (t.inputSchema ?? {
          type: 'object',
          properties: {},
        }) as unknown as Record<string, unknown>,
      }));
    },
    async callTool(name, args) {
      const res = await client.callTool({ name, arguments: args });
      // Our server always responds with text content blocks; join them so the
      // agent loop sees a single string (matching the pre-MCP string result).
      const content = (res as {
        content?: Array<{ type?: string; text?: unknown }>;
      }).content;
      const parts: string[] = [];
      for (const block of content ?? []) {
        if (block.type === 'text' && typeof block.text === 'string') {
          parts.push(block.text);
        }
      }
      return parts.join('\n');
    },
  };
}
