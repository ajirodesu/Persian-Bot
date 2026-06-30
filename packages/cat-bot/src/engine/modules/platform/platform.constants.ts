/**
 * Platform Numeric ID Registry
 *
 * Maps each runtime platform string identifier to a compact integer persisted in
 * bot_users.platform and bot_threads.platform.  Storing Int (4 bytes) instead of
 * VARCHAR cuts per-row overhead ~75% on those two high-volume tables.
 *
 * ── PERMANENT CONTRACT ─────────────────────────────────────────────────────────
 * Never change an existing number.  All historical rows carry the integer and
 * there is no automatic migration.  Only ever APPEND new entries at the bottom.
 *
 * Mapping:
 *   1  discord
 *   2  telegram
 *   3  webchat
 */

// Single source of truth for platform string literals
export const Platforms = {
  Discord: 'discord',
  Telegram: 'telegram',
  // The in-app Chat Room (Socket.io) platform — see
  // packages/cat-bot/src/server/socket/chat-room.socket.ts (WebChatApi).
  // Added as id 3 per the APPEND-only contract above; never reuse/renumber.
  Webchat: 'webchat',
} as const;

export const PLATFORM_TO_ID = {
  [Platforms.Discord]: 1,
  [Platforms.Telegram]: 2,
  [Platforms.Webchat]: 3,
} as const;

export const ID_TO_PLATFORM = {
  1: Platforms.Discord,
  2: Platforms.Telegram,
  3: Platforms.Webchat,
} as const;

/** Union of all recognised platform name strings. */
export type PlatformName = keyof typeof PLATFORM_TO_ID;

/** Union of all assigned numeric platform IDs. */
export type PlatformNumericId = (typeof PLATFORM_TO_ID)[PlatformName];
