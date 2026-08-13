/**
 * Kicks a member from a Fluxer guild. Requires Kick Members permission.
 */
import type { Guild } from '@fluxerjs/core';

export async function removeUserFromGroup(
  guild: Guild | null,
  userID: string,
): Promise<void> {
  if (!guild) throw new Error('Not in a server.');
  await guild.kick(userID);
}