/**
 * Command Parser — prefix stripping and token extraction.
 *
 * Pure function with no side effects — independently testable and reusable
 * across any platform that needs prefix-based command routing.
 */

import type { ParsedCommand } from '@/engine/types/controller.types.js';

/**
 * Strips a trailing Telegram-style "@BotUsername" mention off a command name — e.g.
 * "help@ShiaBot" → "help". Mirrors Telegram's native `/command@BotName` convention, which
 * users often replicate by habit even with custom (non-"/") prefixes.
 *
 * When `botUsername` is known and the mention doesn't match it, the command is treated as
 * addressed to a different bot (common in groups with several bots) and `null` is returned
 * so it's silently ignored rather than misfiring. When `botUsername` is unknown (non-Telegram
 * platforms, or Telegram before bot info is available), the mention is stripped unconditionally.
 */
function stripBotMention(
  commandName: string,
  botUsername?: string,
): string | null {
  const atIndex = commandName.indexOf('@');
  if (atIndex === -1) return commandName;

  const mentioned = commandName.slice(atIndex + 1);
  const bareName = commandName.slice(0, atIndex);
  if (!bareName) return null;

  if (botUsername && mentioned !== botUsername.toLowerCase()) return null;

  return bareName;
}

/**
 * Strips the prefix from the first token and returns the command name + remaining args.
 * Returns null when the body does not start with the prefix.
 *
 * `botUsername` (Telegram only) enables correctly handling commands sent with a stuck
 * "@BotUsername" suffix, e.g. "+help@ShiaBot" — see stripBotMention() above.
 */
export function parseCommand(
  args: string[],
  prefix: string,
  botUsername?: string,
): ParsedCommand | null {
  if (!args.length) return null;

  const tokens = [...args];
  let commandName: string;

  if (tokens[0] === prefix) {
    // Edge case: prefix sent as a standalone token (some platforms split differently)
    if (tokens.length === 1) return null;
    tokens.shift();
    commandName = (tokens.shift() ?? '').toLowerCase();
  } else if (tokens[0]!.startsWith(prefix)) {
    const head = tokens.shift()!;
    commandName = head.slice(prefix.length).toLowerCase();
    if (!commandName) return null;
  } else {
    return null;
  }

  const resolved = stripBotMention(commandName, botUsername);
  if (!resolved) return null;
  commandName = resolved;

  return { name: commandName, args: tokens };
}
