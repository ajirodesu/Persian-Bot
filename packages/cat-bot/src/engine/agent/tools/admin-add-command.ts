/**
 * AI Agent — admin_add_command tool
 *
 * SYSTEM ADMIN ONLY. Creates a NEW command file in the commands folder
 * (packages/cat-bot/src/app/commands) — the only folder this tool can write
 * to. The content must be a valid command module: export `meta`
 * (CommandMeta: name, version, role, author, description, usage, cooldown)
 * and an `onCommand` (or `onChat`) handler. The command roster is loaded at
 * boot, so a restart is required for the new command to activate.
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
  name: 'admin_add_command',
  description:
    'SYSTEM ADMIN ONLY — create a NEW bot command file inside the commands ' +
    `folder (${COMMANDS_REPO_DIR}). ` +
    "Pass `filename` (e.g. 'joke.ts', must end in .ts with no slashes) and the " +
    'complete TypeScript source as `content` — a command module that exports ' +
    '`meta` (CommandMeta: name, version, role, author, description, usage, ' +
    'cooldown) and an `onCommand` (or `onChat`) handler. Writes to the git ' +
    'working tree only (no commit); the command activates after a bot restart.',
  parameters: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description:
          "New command file name, e.g. 'joke.ts' (single .ts file name, no slashes).",
      },
      content: {
        type: 'string',
        description:
          'Complete TypeScript source of the command module — must export `meta` ' +
          'and an `onCommand` (or `onChat`) handler.',
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
      return 'No content provided — pass the full command module source.';
    }
    assertCommandModuleContent(body, repoPath.split('/').pop() ?? repoPath);
    await writeRepoFile(repoPath, body, true);
    return (
      `Created ${repoPath} (${Buffer.byteLength(body, 'utf8')} bytes). ` +
      'The command roster is loaded at startup — restart the bot for the new ' +
      `command to take effect. ${saveChangesHint()}`
    );
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};
