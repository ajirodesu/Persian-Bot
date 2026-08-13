/**
 * Returns the Fluxer bot's own user ID.
 * client.user is populated after READY; guild.members.fetchMe() is the fallback
 * when guild context is available.
 */
import type { Client, Guild } from '@fluxerjs/core';

export async function getBotID(
  client: Client | null,
  guild: Guild | null = null,
): Promise<string> {
  if (client?.user?.id) return client.user.id;
  if (guild?.id) {
    try {
      const me = await guild.fetchMe();
      if (me?.id) return me.id;
    } catch {
      /* fall through */
    }
  }
  throw new Error(
    'Cannot determine bot ID for Fluxer channel API — client reference missing',
  );
}