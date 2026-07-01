/**
 * Web Platform Constants — Single Source of Truth
 *
 * Mirrors cat-bot's platform.constants.ts so the web client and server runtime
 * use identical string identifiers.
 */

export const Platforms = {
  Discord: 'discord',
  Telegram: 'telegram',
} as const

/** Union of all recognised platform name strings. */
export type Platform = (typeof Platforms)[keyof typeof Platforms]

/**
 * Human-readable display labels for platform identifiers.
 * Typed as Record<string, string> so getPlatformLabel() can accept arbitrary
 * strings without a cast while still providing correct values for all known platforms.
 */
export const PLATFORM_LABELS: Record<string, string> = {
  [Platforms.Discord]: 'Discord',
  [Platforms.Telegram]: 'Telegram',
}
