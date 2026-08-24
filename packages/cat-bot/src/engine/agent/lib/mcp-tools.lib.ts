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
import {
  cachedIsBotAdmin,
  cachedIsBotPremium,
  cachedIsThreadAdmin,
  cachedIsSystemAdmin,
} from '@/engine/lib/auth-cache.lib.js';
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

// Tool descriptions are trimmed to a hard token budget — long schema text is
// sent to the LLM on EVERY request (system + each tool call), so a few verbose
// tool files silently inflate the cost of every turn. The cap keeps selection
// accurate while cutting redundant instructions (which now live in the prompt).
const TOOL_DESCRIPTION_MAX_CHARS = 280;
const TOOL_PARAM_DESCRIPTION_MAX_CHARS = 220;

function capDescription(description: string): string {
  return description.length > TOOL_DESCRIPTION_MAX_CHARS
    ? `${description.slice(0, TOOL_DESCRIPTION_MAX_CHARS).trimEnd()}…`
    : description;
}

/**
 * Trims every property `description` inside a JSON-schema parameters object —
 * those strings are part of the schema sent to the LLM on every request too.
 * Walks only the top-level properties (no nested schemas) to keep it simple.
 */
function capParameterDescriptions(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const props = (parameters['properties'] ?? {}) as Record<
    string,
    { description?: unknown; [k: string]: unknown }
  >;
  if (!props || typeof props !== 'object') return parameters;
  const out: Record<string, unknown> = { ...parameters };
  const newProps: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(props)) {
    if (def && typeof def === 'object' && typeof def['description'] === 'string') {
      const desc = def['description'] as string;
      newProps[key] =
        desc.length > TOOL_PARAM_DESCRIPTION_MAX_CHARS
          ? { ...def, description: `${desc.slice(0, TOOL_PARAM_DESCRIPTION_MAX_CHARS).trimEnd()}…` }
          : def;
    } else {
      newProps[key] = def;
    }
  }
  out['properties'] = newProps;
  return out;
}

// ── External MCP schema hygiene ────────────────────────────────────────────────
// External MCP servers (admin-configured) can return arbitrarily verbose tool
// schemas — some ship multi-KB descriptions. Those schemas are sent to the LLM
// on EVERY request, so uncapped external tools silently inflate every turn the
// way verbose internal ones used to. The same budgets the internal tools obey
// are applied at the merge point, plus removal of pure bookkeeping keys
// ($schema/title) that cost tokens without helping the model.

const EXTERNAL_SCHEMA_STRIP_KEYS = new Set(['$schema', 'title']);

/** Recursively strips bookkeeping keys from a JSON-schema-like object. */
function stripSchemaNoise(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSchemaNoise);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (EXTERNAL_SCHEMA_STRIP_KEYS.has(k)) continue;
    out[k] = stripSchemaNoise(v);
  }
  return out;
}

/**
 * Applies the internal token budgets to an external MCP tool schema:
 * description caps, per-parameter description caps, and bookkeeping-key strip.
 * Returns null when the tool is unusable (no name) so it can be dropped.
 */
function sanitizeExternalSchema(
  tool: McpToolSchema,
): McpToolSchema | null {
  if (!tool.name) return null;
  return {
    name: tool.name,
    description: capDescription(tool.description ?? ''),
    parameters: capParameterDescriptions(
      stripSchemaNoise(tool.parameters ?? { type: 'object', properties: {} }) as Record<
        string,
        unknown
      >,
    ),
  };
}

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
 * Builds the per-turn role gate for external MCP servers — the same
 * minimum-role semantics as command meta.role (enforcePermission in
 * on-command.middleware): system admins pass every gate, otherwise each gate
 * checks its own qualifying roles (thread admin / premium / bot admin).
 * Fail-closed on auth errors: a gate that cannot be verified denies.
 */
async function buildExternalRoleGate(
  ctx: ToolContext,
): Promise<(server: { role: number }) => boolean> {
  const senderID = (ctx.event['senderID'] as string) ?? '';
  const threadID = (ctx.event['threadID'] as string) ?? '';
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;

  const check = async (fn: () => Promise<boolean>): Promise<boolean> => {
    if (!senderID) return false;
    try {
      return await fn();
    } catch {
      return false;
    }
  };

  const results = {
    systemAdmin: await check(() => cachedIsSystemAdmin(ctx, senderID)),
    botAdmin: false,
    premium: false,
    threadAdmin: false,
  };
  if (!results.systemAdmin) {
    results.botAdmin = await check(() =>
      cachedIsBotAdmin(ctx, sessionUserId, platform, sessionId, senderID),
    );
    results.premium = await check(() =>
      cachedIsBotPremium(ctx, sessionUserId, platform, sessionId, senderID),
    );
    results.threadAdmin = threadID
      ? await check(() => cachedIsThreadAdmin(ctx, threadID, senderID))
      : false;
  }

  return (server) => {
    const role = typeof server.role === 'number' ? server.role : 0;
    if (role <= 0) return true; // anyone
    if (results.systemAdmin) return true; // system admins pass every gate
    switch (role) {
      case 1: // group/thread admin — thread, bot, premium members all qualify
        return results.threadAdmin || results.botAdmin || results.premium;
      case 2: // premium — premium, bot admins (mirrors enforcePermission)
        return results.premium || results.botAdmin;
      case 3: // bot admin
        return results.botAdmin;
      case 4: // system admin
        return false;
      default:
        return false;
    }
  };
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
      description: capDescription(t.meta.description),
      parameters: capParameterDescriptions(
        t.meta.parameters as Record<string, unknown>,
      ),
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
  // external-mcp.lib.ts, so the per-turn cost here is just a reconcile. The
  // role gate mirrors command meta.role enforcement — servers whose role
  // requirement the sender doesn't meet are excluded from this turn entirely.
  const roleGate = await buildExternalRoleGate(ctx);
  const external = await getExternalMcpToolSet(roleGate);
  const externalSchemas = external.schemas
    .map(sanitizeExternalSchema)
    .filter((s): s is McpToolSchema => s !== null);

  return {
    schemas: [...schemas, ...externalSchemas],
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
