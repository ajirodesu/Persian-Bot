/**
 * AI Agent — list_commands tool
 *
 * Returns a serialized catalogue of the bot's commands, filtered by the
 * requesting user's role. Delegates to ToolContext.listCommands, which the
 * handler binds to the live command map so the LLM always sees current data.
 */

import type { ToolMeta, ToolContext } from '../agent-tool.types.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'list_commands',
  description:
    'List all available bot commands with descriptions, usage, and required role. ' +
    "Pass 'admin' to see admin-only commands, 'premium' for premium commands, or omit for all.",
  parameters: {
    type: 'object',
    properties: {
      role: {
        type: 'string',
        description:
          "Role filter: 'all' (default), 'admin', 'premium', 'super-admin', or 'user'",
      },
    },
    required: [],
  },
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  { role }: { role?: string },
  ctx: ToolContext,
): Promise<string> => {
  return ctx.listCommands(String(role ?? 'all'));
};
