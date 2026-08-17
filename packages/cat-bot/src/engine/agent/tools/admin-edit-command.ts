/**
 * AI Agent — admin_edit_command tool
 *
 * SYSTEM ADMIN ONLY. Modifies, fixes, or rewrites an EXISTING command file in
 * the commands folder (packages/cat-bot/src/app/commands). Read the current
 * file first with admin_read_command, then pass the filename and the COMPLETE
 * new content — the whole file is replaced. The content must remain a valid
 * command module (export `meta` + `onCommand`/`onChat`), otherwise the tool
 * refuses: an edit that breaks the command is a capability failure and the
 * user is advised to try a higher-capability AI model.
 */

import type { ToolMeta, ToolContext } from '../agent-tool.types.js';
import {
  requireSystemAdmin,
  commandRepoPath,
  writeRepoFile,
  assertCommandModuleContent,
  saveChangesHint,
  COMMANDS_REPO_DIR,
} from '../lib/admin-source-tools.lib.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'admin_edit_command',
  description:
    'SYSTEM ADMIN ONLY — modify, fix, or rewrite an EXISTING bot command ' +
    `file inside the commands folder (${COMMANDS_REPO_DIR}). ` +
    'Read it first with admin_read_command, then pass `filename` (e.g. ' +
    "'ping.ts') and the COMPLETE new `content` (the whole file is replaced). " +
    'Content must remain a valid command module (export `meta` and an ' +
    '`onCommand`/`onChat` handler). Writes to the git working tree only; ' +
    'changes take effect after a bot restart.',
  parameters: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description:
          "The command file name to modify, e.g. 'ping.ts' (single .ts file name, no slashes).",
      },
      content: {
        type: 'string',
        description:
          'The COMPLETE new TypeScript source for the file — must still export ' +
          '`meta` and an `onCommand` (or `onChat`) handler.',
      },
    },
    required: ['filename', 'content'],
  },
  adminOnly: true,
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  { filename, content }: { filename?: string; content?: string },
  ctx: ToolContext,
): Promise<string> => {
  const denial = await requireSystemAdmin(ctx);
  if (denial) return denial;
  try {
    const repoPath = commandRepoPath(String(filename ?? ''));
    const body = String(content ?? '');
    if (!body.trim()) {
      return 'No content provided — pass the complete new command module source.';
    }
    assertCommandModuleContent(body, repoPath.split('/').pop() ?? repoPath);
    await writeRepoFile(repoPath, body, false);
    return (
      `Saved ${repoPath} (${Buffer.byteLength(body, 'utf8')} bytes). ` +
      `Changes take effect after a bot restart. ${saveChangesHint()}`
    );
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};
