/**
 * Usage Guide Factory — shared utility for command and button dispatchers.
 *
 * Centralised here so both command.dispatcher.ts and button.dispatcher.ts can
 * inject a bound `usage()` function into AppCtx without duplicating logic.
 *
 * Field resolution order:
 *   meta.guide  → preferred; supports a string[] for multi-line patterns
 *   meta.usage  → legacy string fallback (all existing commands use this)
 *   (empty)       → shows bare prefix+name with no arg pattern
 */

import type { createChatContext } from '@/engine/adapters/models/context.model.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

/**
 * Creates a bound `usage()` function for a command module.
 *
 * Reads the command's meta (name, guide/usage, description) and sends a
 * formatted usage guide via the provided chat context.
 *
 * `meta.guide` takes precedence over `meta.usage` so existing commands
 * that declare `usage: '[arg]'` continue to work without changes, while new
 * commands can declare `guide: ['[arg1]', '[arg2]']` for multi-line guides.
 *
 * @param command  - The loaded command module (exports object).
 * @param chat     - The command-scoped chat context (from createChatContext).
 * @param prefix   - The active prefix string for this session.
 * @returns        An async function that sends the usage guide as a reply.
 *
 * @example
 * // Inside onCommand — show guide when required arg is missing
 * export const onCommand = async ({ args, usage }: AppCtx) => {
 *   if (!args[0]) return usage();
 *   // ...
 * };
 */
export function createUsage(
  command: Record<string, unknown>,
  chat: ReturnType<typeof createChatContext>,
  prefix: string,
): () => Promise<void> {
  return async function usage(): Promise<void> {
    const cfg = (command['meta'] as Record<string, unknown>) ?? {};

    // `guide` (array-friendly, new) takes precedence over legacy `usage` (string)
    const rawGuide = cfg['guide'] ?? cfg['usage'];
    const guides: string[] = Array.isArray(rawGuide)
      ? (rawGuide as string[])
      : [typeof rawGuide === 'string' ? rawGuide : ''];

    let text = '▫️ **Usage Guide:**\n\n';
    for (const g of guides)
      text += g
        ? `\`${prefix}${cfg['name']} ${g}\`\n`
        : `\`${prefix}${cfg['name']}\`\n`;
    text += `\n📄 ${(cfg['description'] as string) || 'No description provided.'}`;

    await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: text });
  };
}
