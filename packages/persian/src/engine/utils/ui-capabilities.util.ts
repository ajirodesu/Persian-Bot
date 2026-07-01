/**
 * UI Capabilities Utility
 *
 * Centralizes capability checks across platforms to keep command modules DRY.
 */

import { Platforms } from '@/engine/modules/platform/platform.constants.js';

/**
 * Determines if a platform supports native visual interactive components (buttons).
 * Both Discord and Telegram support embedded buttons smoothly.
 *
 * @param platform - The target platform identifier
 * @returns True if the platform supports native UI buttons
 */
export function hasNativeButtons(platform: string): boolean {
  return (
    platform === Platforms.Discord ||
    platform === Platforms.Telegram ||
    platform === Platforms.Webchat
  );
}
