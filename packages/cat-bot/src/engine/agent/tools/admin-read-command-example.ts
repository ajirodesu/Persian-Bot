/**
 * AI Agent — admin_read_command_example tool
 *
 * SYSTEM ADMIN ONLY. Lists and reads the reference command examples in
 * examples/commands — the canonical templates for how Cat-Bot commands are
 * written. Use these as models when generating or editing commands:
 *
 *   • example_command.ts  — simplest command: meta + onCommand that replies
 *   • example_on_chat.ts  — onChat passive listener (runs on every message)
 *   • example_reply.ts    — two-step onReply conversation flow
 *   • example_buttons.ts  — interactive button lifecycle
 *   • example_react.ts    — emoji-keyed onReact flow
 *
 * The folder is READ-ONLY — examples can never be modified through this tool.
 */

import type { ToolMeta, ToolContext } from '../agent-tool.types.js';
import {
  requireSystemAdmin,
  listExampleCommands,
  readExampleCommand,
  EXAMPLES_COMMANDS_DIR,
} from '../lib/admin-source-tools.lib.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'admin_read_command_example',
  description:
    'SYSTEM ADMIN ONLY — read the reference command examples in ' +
    `examples/commands (${EXAMPLES_COMMANDS_DIR}): example_command.ts ` +
    '(simple onCommand reply), example_on_chat.ts (passive listener), ' +
    'example_reply.ts (onReply conversation flow), example_buttons.ts ' +
    '(interactive buttons), example_react.ts (onReact flow). Pass `filename` ' +
    'to read one example; omit it to list what is available. Read-only — ' +
    'examples are never modified. Use these as templates when creating or ' +
    'editing commands.',
  parameters: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description:
          "Example file name, e.g. 'example_buttons.ts'. Omit to list the available examples.",
      },
    },
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
    if (!filename || !String(filename).trim()) {
      const files = await listExampleCommands();
      if (files.length === 0) {
        return `The examples folder (${EXAMPLES_COMMANDS_DIR}) has no .ts files.`;
      }
      return (
        `Command examples (${files.length}) in ${EXAMPLES_COMMANDS_DIR}:\n` +
        files.map((f) => `• ${f}`).join('\n') +
        '\n\nPass a filename to read one — use them as templates when ' +
        'creating or editing commands.'
      );
    }
    const repoPath = String(filename).trim();
    const content = await readExampleCommand(repoPath);
    return `— ${EXAMPLES_COMMANDS_DIR}/${repoPath} (${Buffer.byteLength(content, 'utf8')} bytes) —\n\n${content}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};
