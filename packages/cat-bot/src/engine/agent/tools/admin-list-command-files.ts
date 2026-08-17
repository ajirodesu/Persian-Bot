/**
 * AI Agent — admin_list_command_files tool
 *
 * SYSTEM ADMIN ONLY. Lists every command file in the commands folder
 * (packages/cat-bot/src/app/commands). Filenames mirror command names, so this
 * is the discovery step before adding, editing, or removing a command.
 */

import type { ToolMeta, ToolContext } from '../agent-tool.types.js';
import {
  requireSystemAdmin,
  listCommandFiles,
  COMMANDS_REPO_DIR,
} from '../lib/admin-source-tools.lib.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'admin_list_command_files',
  description:
    'SYSTEM ADMIN ONLY — list every command file in the commands folder ' +
    `(${COMMANDS_REPO_DIR}). ` +
    'Each filename is the command name plus .ts. Use this before adding, ' +
    'editing, or removing a command.',
  parameters: {
    type: 'object',
    properties: {},
  },
  adminOnly: true,
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> => {
  const denial = await requireSystemAdmin(ctx);
  if (denial) return denial;
  try {
    const files = await listCommandFiles();
    if (files.length === 0) {
      return `The commands folder (${COMMANDS_REPO_DIR}) has no .ts files.`;
    }
    const lines = files.map((f) => `• ${f}`).join('\n');
    return (
      `Command files (${files.length}):\n${lines}\n\n` +
      'Changes to this folder take effect after a bot restart — new commands ' +
      'are loaded at startup only.'
    );
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};
