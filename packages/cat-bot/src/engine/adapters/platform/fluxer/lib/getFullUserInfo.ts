/**
 * Returns a UnifiedUserInfo for a Fluxer user ID.
 * Resolution order:
 *   1. client.users.fetch() — REST, most complete data
 *   2. guild.fetchMember().user — server-scoped fallback
 *   3. Stub with id only — ensures callers always receive a valid object
 */
import type { Client, Guild } from '@fluxerjs/core';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { createUnifiedUserInfo } from '@/engine/adapters/models/user.model.js';
import type { UnifiedUserInfo } from '@/engine/adapters/models/user.model.js';

export async function getFullUserInfo(
  client: Client | null,
  guild: Guild | null,
  userID: string,
): Promise<UnifiedUserInfo> {
  let user: import('@fluxerjs/core').User | null = null;

  try {
    user = client ? await client.users.fetch(userID) : null;
  } catch {
    /* try next source */
  }
  if (!user && guild) {
    try {
      user = (await guild.fetchMember(userID)).user;
    } catch {
      /* try stub */
    }
  }

  if (!user) {
    return createUnifiedUserInfo({
      platform: Platforms.Fluxer,
      id: userID,
      name: `User ${userID}`,
    });
  }

  return createUnifiedUserInfo({
    platform: Platforms.Fluxer,
    id: user.id,
    name: user.globalName ?? user.username,
    firstName: null,
    username: user.username,
    avatarUrl: user.displayAvatarURL?.({ size: 256, extension: 'png' }) ?? null,
  });
}