/**
 * Reaction Emoji Constants — Web
 *
 * Mirrors packages/cat-bot/src/engine/constants/reaction-emoji.constants.ts so
 * the dashboard pickers and client-side validation behave EXACTLY like the
 * server-side validation. Keep the two files in sync.
 */

/** Fallback shown when a session has never had a reaction emoji configured. */
export const DEFAULT_COMMAND_REACT_EMOJI = '🔥'

/**
 * Complete set of emoji Telegram's Bot API accepts for ReactionTypeEmoji
 * reactions (verified against the official Bot API docs). Any emoji outside
 * this list is rejected by Telegram, so the Telegram picker is built from this
 * exact array.
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
] as const

/** Curated palette of common unicode emoji shown as quick-picks on Discord. */
export const DISCORD_COMMON_REACTION_EMOJIS: readonly string[] = [
  '🔥', '✅', '❌', '👍', '👎', '❤️', '💯', '😄', '🤣', '😮',
  '😢', '🎉', '🎊', '👏', '🙏', '✨', '⭐', '🏆', '💪', '🙌',
]

/** Matches a Discord custom-emoji reference, e.g. :cat: or <a:party:123...>. */
const DISCORD_CUSTOM_EMOJI_PATTERN = /^<a?:[a-zA-Z0-9_]{2,32}:\d{17,21}>$/

const DISCORD_EMOJI_UNIT =
  '(?:[0-9#*]\\uFE0F\\u20E3|\\p{Extended_Pictographic}\\uFE0F?|\\p{Regional_Indicator}\\p{Regional_Indicator})'

const DISCORD_UNICODE_EMOJI_PATTERN = new RegExp(
  `^(?:${DISCORD_EMOJI_UNIT}(?:\\p{Emoji_Modifier})?)(?:\\u200D${DISCORD_EMOJI_UNIT}(?:\\p{Emoji_Modifier})?)*$`,
  'u',
)

/** Whether the given emoji is in Telegram's supported reaction set. */
export function isTelegramReactionEmoji(emoji: string): boolean {
  return TELEGRAM_REACTION_EMOJIS.includes(emoji)
}

/** Whether the given emoji is a valid Discord reaction (unicode or custom ref). */
export function isDiscordReactionEmoji(emoji: string): boolean {
  if (!emoji) return false
  return (
    DISCORD_CUSTOM_EMOJI_PATTERN.test(emoji) ||
    DISCORD_UNICODE_EMOJI_PATTERN.test(emoji)
  )
}
