/**
 * Author: AjiroDesu
 *
 * Bot platform-identity derivation for admin listings.
 *
 * Derives a bot's own platform ID from already-stored session credentials —
 * never a live platform lookup, so admin list endpoints stay a single DB
 * round-trip with zero per-row API calls:
 * - Discord stores its client (application) ID in plaintext.
 * - Telegram embeds the numeric bot ID in the token prefix (`<id>:<secret>`);
 *   tokens are encrypted at rest, so decryption happens in-process here.
 * - Fluxer tokens are opaque — no ID is derivable; returns undefined.
 *
 * Usernames are not persisted anywhere, so callers leave botUsername absent
 * (the UI renders an "Unknown" placeholder) until identity is stored at
 * connect time. Fail-open throughout: any decryption/shape problem yields
 * undefined rather than failing the whole listing.
 */
import { decrypt } from '@/engine/utils/crypto.util.js';
import { ID_TO_PLATFORM, Platforms } from './platform.constants.js';

export function deriveBotPlatformId(
  platformId: number,
  discordClientId: string | null | undefined,
  telegramTokenEnc: string | null | undefined,
): string | undefined {
  try {
    const platform =
      (ID_TO_PLATFORM as Record<number, string>)[platformId] ?? '';
    if (platform === Platforms.Discord) {
      const id = (discordClientId ?? '').trim();
      return id || undefined;
    }
    if (platform === Platforms.Telegram) {
      if (!telegramTokenEnc) return undefined;
      const token = decrypt(telegramTokenEnc);
      const prefix = token.split(':')[0]?.trim() ?? '';
      return /^\d+$/.test(prefix) ? prefix : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
