/**
 * Shared test ID constants for all platform integration tests.
 *
 * These IDs are sourced from real events captured from the running bot and
 * anchor test assertions against live data. They are extracted from the original
 * monolithic test file to eliminate duplication across platform test files.
 *
 * ── Why these are constants ───────────────────────────────────────────────────
 * Each platform test uses the same IDs for:
 *   - reactToMessage — reacting to a real "!react" command
 *   - unsendMessage — attempting to delete a real message
 *   - getUserInfo — fetching real user profiles
 *
 * Centralizing ensures all platforms reference the same test targets.
 */

// ============================================================================
// DISCORD
// ============================================================================

// Discord — from real "!react" messageCreate event
export const DISCORD_GUILD_ID = '1485133927202160830'; // event.raw.guildId
export const DISCORD_CHANNEL_ID = '1486625151603839067'; // event.threadID (= event.raw.channelId)
export const DISCORD_MESSAGE_ID = '1486695291259191518'; // event.messageID

// ============================================================================
// TELEGRAM
// ============================================================================

// Telegram — from real "!react" message update
export const TELEGRAM_CHAT_ID = '-5151751558'; // event.threadID
export const TELEGRAM_BOT_ID = 8591213720; // event.raw.botInfo.id
export const TELEGRAM_MESSAGE_ID = '305'; // event.messageID

// ============================================================================
// TARGET USER IDs — sourced from real !uid command logs
// Used to exercise setNickname against a real non-bot participant,
// complementing the existing bot-self tests that only cover the bot's own ID.
// ============================================================================

// Discord — senderID from "!uid" messageCreate log
export const DISCORD_TARGET_USER_ID = '1431217307023315020';

// Telegram — senderID from "!uid" message update log
export const TELEGRAM_TARGET_USER_ID = '8509577343';
