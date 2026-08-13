/**
 * Fluxer — Avatar URL Resolution
 *
 * Retrieves a user's avatar URL using the @fluxerjs/core User / GuildMember API.
 *
 * Resolution order (cache-agnostic, REST safe):
 *   1. client.users.fetch(userID) — global User object (covers DM contexts).
 *   2. guild.members.fetchMember(userID) — server-scoped GuildMember with
 *      guild-specific avatar overrides.
 *
 * displayAvatarURL() returns the default avatar (a coloured Fluxer logo) when the
 * user has no custom avatar, so this function never returns null when a
 * client/guild reference is available.
 */
import type { Client, Guild } from '@fluxerjs/core';

/**
 * @param client - @fluxerjs/core Client used for REST fallback (client.users.fetch); null in guild-only contexts
 * @param guild  - Current guild for server-scoped member lookup; null in DM contexts
 * @param userID - Fluxer snowflake user ID (as string)
 * @returns Avatar URL string, or null if resolution fails entirely
 */
export async function getAvatarUrl(
  client: Client | null,
  guild: Guild | null,
  userID: string,
): Promise<string | null> {
  // Global user lookup first — covers DMs and non-member contexts
  if (client) {
    try {
      const user = await client.users.fetch(userID);
      return (
        user.displayAvatarURL?.({ size: 256, extension: 'png' }) ?? null
      );
    } catch {
      /* try guild member */
    }
  }

  if (guild) {
    try {
      const member = await guild.fetchMember(userID);
      return (
        member.displayAvatarURL?.({ size: 256, extension: 'png' }) ?? null
      );
    } catch {
      return null;
    }
  }

  return null;
}