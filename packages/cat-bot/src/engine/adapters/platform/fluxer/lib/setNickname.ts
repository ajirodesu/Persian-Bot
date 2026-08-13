/**
 * Sets a member's guild nickname on Fluxer.
 */
import type { Guild } from '@fluxerjs/core';

export async function setNickname(
  guild: Guild | null,
  userID: string,
  nickname: string,
): Promise<void> {
  if (!guild) throw new Error('Not in a server.');
  const member = await guild.fetchMember(userID);
  await member.edit({ nick: nickname });
}