/**
 * Renames a Fluxer guild. Requires guild owner or Administrator permissions.
 */
import type { Guild } from '@fluxerjs/core';

export async function setGroupName(
  guild: Guild | null,
  name: string,
): Promise<void> {
  if (!guild) throw new Error('Not in a server.');
  await guild.edit({ name });
}