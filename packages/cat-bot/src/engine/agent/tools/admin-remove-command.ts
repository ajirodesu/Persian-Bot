/**
 * AI Agent — admin_remove_command tool
 *
 * SYSTEM ADMIN ONLY. Deletes an EXISTING command file from the commands
 * folder (packages/cat-bot/src/app/commands). The deletion is immediate and
 * irreversible from the working tree (recoverable only via git). The command
 * stops being served after a bot restart, when the roster is reloaded.
 */

import type { ToolMeta, ToolContext } from '../agent-tool.types.js';
import {
  requireSystemAdmin,
  commandRepoPath,
  deleteRepoFile,
  saveChangesHint,
  COMMANDS_REPO_DIR,
} from '../lib/admin-source-tools.lib.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'admin_remove_command',
  description:
    'SYSTEM ADMIN ONLY — delete an EXISTING bot command file from the ' +
    `commands folder (${COMMANDS_REPO_DIR}). ` +
    "Pass `filename` (e.g. 'unused.ts'). The file is removed from the git " +
    'working tree immediately (recoverable via git); the command stops ' +
    'being served after a bot restart.',
  parameters: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description:
          "The command file name to delete, e.g. 'unused.ts' (single .ts file name, no slashes).",
      },
    },
    required: ['filename'],
  },
  adminOnly: true,
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  { filename }: { filename?: string },
  ctx: ToolContext,
): Promise<string> => {
  const denial = await requireSystemAdmin(ctx);
  if (denial) return denial;
  try {
    const repoPath = commandRepoPath(String(filename ?? ''));
    await deleteRepoFile(repoPath);
    return (
      `Deleted ${repoPath}. The command stops being served after a bot ` +
      `restart. ${saveChangesHint()}`
    );
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};
