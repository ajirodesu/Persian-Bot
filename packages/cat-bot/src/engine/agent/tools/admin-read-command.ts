/**
 * AI Agent — admin_read_command tool
 *
 * SYSTEM ADMIN ONLY. Reads the full source of one command file inside the
 * commands folder (packages/cat-bot/src/app/commands). Always read before
 * editing or fixing a command so the rewrite is based on the real file.
 */

import type { ToolMeta, ToolContext } from '../agent-tool.types.js';
import {
  requireSystemAdmin,
  commandRepoPath,
  readRepoFile,
} from '../lib/admin-source-tools.lib.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'admin_read_command',
  description:
    'SYSTEM ADMIN ONLY — read the full source of an existing command file ' +
    "inside the commands folder. Pass the filename only, e.g. 'ping.ts'. " +
    'Use before editing or fixing a command.',
  parameters: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description:
          "The command file name, e.g. 'ping.ts' (single .ts file name, no slashes).",
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
    const content = await readRepoFile(repoPath);
    return (
      `— ${repoPath} (${Buffer.byteLength(content, 'utf8')} bytes) —\n\n` +
      content
    );
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};
