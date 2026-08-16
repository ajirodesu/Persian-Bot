/**
 * AI Agent — run_command tool
 *
 * Executes a bot command through the real dispatcher and returns its reply.
 * The agent runner intercepts this tool before it reaches the registry and
 * returns a sentinel, so the handler delivers the command result itself — this
 * initialize is the fallback used when the command is dispatched directly.
 *
 * Note: the modern flow prefers test_command (silent preview) + send_result
 * (unified delivery) so the agent can inspect output before committing.
 */

import type { ToolMeta, ToolContext } from './types.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'run_command',
  description:
    'Run a bot command and return its reply text. ' +
    'Pass the full command line including the command name and any arguments ' +
    "(e.g. 'balance', 'weather jakarta'). Prefer test_command + send_result for " +
    'commands whose output you want to preview before sending.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description:
          "The command to run without the prefix, e.g. 'balance' or 'weather jakarta'",
      },
    },
    required: ['command'],
  },
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  { command }: { command?: string },
  ctx: ToolContext,
): Promise<string> => {
  const cmd = String(command ?? '').trim();
  if (!cmd) return 'No command provided.';
  const { ok, output, error } = await ctx.runBotCommand(cmd);
  return ok
    ? (output ?? 'Command executed.')
    : `Command failed: ${error ?? 'unknown error'}`;
};
