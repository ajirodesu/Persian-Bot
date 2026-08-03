/**
 * Reaction Emoji Registry
 *
 * Defines the emoji the bot reacts with on the user's triggering message once
 * a command has finished executing successfully. The value is stored per bot
 * session (see engine/repos/reaction-emoji.repo.ts) and configured through the
 * web dashboard — it is deliberately NOT an environment variable, so operators
 * can change it live without restarting the process.
 *
 * This module is the single source of truth for:
 *   - the default emoji (used when a session has never been configured)
 *   - the exact set of emoji Telegram accepts via setMessageReaction
 *   - the Discord unicode/custom-emoji acceptance rules
 *   - per-platform validation helpers shared by the repo, controller and tests
 */

/** Fallback used when a session has never had a reaction emoji configured. */
export const DEFAULT_COMMAND_REACT_EMOJI = '🔥';

/**
 * Complete set of emoji Telegram's Bot API accepts for ReactionTypeEmoji
 * reactions (verified against the official Bot API 10.2 docs — the 73 entries
 * in `ReactionTypeEmoji.emoji`). Any emoji outside this list is rejected by
 * Telegram with a 400 error, so the dashboard picker and server validation
 * both derive from this array.
 */
export const TELEGRAM_REACTION_EMOJIS: readonly string[] = [
  '❤', '👍', '👎', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱',
  '🤬', '😢', '🎉', '🤩', '🤮', '💩', '🙏', '👌', '🕊', '🤡',
  '🥱', '🥴', '😍', '🐳', '\u2764\u200D\u{1F525}', '🌚', '🌭', '💯', '🤣', '⚡',
  '🍌', '🏆', '💔', '🤨', '😐', '🍓', '🍾', '💋', '🖕', '😈',
  '😴', '😭', '🤓', '👻', '\u{1F468}\u200D\u{1F4BB}', '👀', '🎃', '🙈', '😇', '😨',
  '🤝', '✍', '🤗', '🫡', '🎅', '🎄', '☃', '💅', '🤪', '🗿',
  '🆒', '💘', '🙉', '🦄', '😘', '💊', '🙊', '😎', '👾', '\u{1F937}\u200D\u2642',
  '🤷', '\u{1F937}\u200D\u2640', '😡',
] as const;

/**
 * One "emoji unit" for Discord unicode reactions: a keycap sequence
 * (1️⃣ / #️⃣), a pictograph (optionally with VS16), or a two-codepoint
 * regional-indicator flag (🇺🇸). A unit may carry an Emoji_Modifier (skin tone).
 */
const DISCORD_EMOJI_UNIT =
  '(?:[0-9#*]\\uFE0F\\u20E3|\\p{Extended_Pictographic}\\uFE0F?|\\p{Regional_Indicator}\\p{Regional_Indicator})';

/** Matches a single (or ZWJ-joined) unicode emoji sequence, e.g. 🔥 or 👨👩👧. */
const DISCORD_UNICODE_EMOJI_PATTERN = new RegExp(
  `^(?:${DISCORD_EMOJI_UNIT}(?:\\p{Emoji_Modifier})?)(?:\\u200D${DISCORD_EMOJI_UNIT}(?:\\p{Emoji_Modifier})?)*$`,
  'u',
);

/** Matches a Discord custom-emoji reference, e.g. :cat: or <a:party:123...>. */
const DISCORD_CUSTOM_EMOJI_PATTERN = /^<a?:[a-zA-Z0-9_]{2,32}:\d{17,21}>$/;

/** Whether the given emoji is one of the emoji Telegram accepts for reactions. */
export function isTelegramReactionEmoji(emoji: string): boolean {
  return (TELEGRAM_REACTION_EMOJIS as readonly string[]).includes(emoji);
}

/**
 * Whether the given emoji is a valid Discord reaction: a unicode emoji
 * sequence OR a custom-emoji reference. Custom references must carry a
 * 17-21 digit snowflake — the bot can only react with custom emoji it can
 * access in the target server.
 */
export function isDiscordReactionEmoji(emoji: string): boolean {
  if (!emoji) return false;
  return (
    DISCORD_CUSTOM_EMOJI_PATTERN.test(emoji) ||
    DISCORD_UNICODE_EMOJI_PATTERN.test(emoji)
  );
}

/**
 * Per-platform reaction-emoji validation. Unrecognised platforms are accepted
 * as-is (the platform adapters that support reactions — Discord/Telegram — are
 * validated; others simply won't fire a reaction on failure).
 */
export function isValidReactionEmoji(platform: string, emoji: string): boolean {
  if (platform === 'telegram') return isTelegramReactionEmoji(emoji);
  if (platform === 'discord') return isDiscordReactionEmoji(emoji);
  return true;
}
