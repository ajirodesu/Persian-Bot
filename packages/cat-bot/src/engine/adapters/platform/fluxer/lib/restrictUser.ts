/**
 * Fluxer — restrictUser / unrestrictUser
 *
 * Fluxer has no permission-scoped "mute" concept identical to Telegram's
 * restrictChatMember — the closest native equivalent is a member Timeout
 * (`communication_disabled_until`), which strips the ability to send
 * messages/react/join voice for a bounded period without removing the member
 * from the server. Fluxer caps a single timeout at 28 days (2,419,200,000 ms);
 * durations beyond that are clamped rather than rejected.
 */
import type { Guild } from '@fluxerjs/core';

/** Fluxer's hard ceiling on a single timeout duration. */
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

export async function restrictUser(
  guild: Guild | null,
  userID: string,
  durationMs?: number,
): Promise<void> {
  if (!guild) throw new Error('Not in a server.');
  const member = await guild.fetchMember(userID);
  const ms = Math.min(durationMs ?? MAX_TIMEOUT_MS, MAX_TIMEOUT_MS);
  await member.edit({
    communicationDisabledUntil: new Date(Date.now() + ms).toISOString(),
    timeoutReason: 'Restricted by bot command',
  });
}

export async function unrestrictUser(
  guild: Guild | null,
  userID: string,
): Promise<void> {
  if (!guild) throw new Error('Not in a server.');
  const member = await guild.fetchMember(userID);
  // Passing null clears an active timeout immediately.
  await member.edit({
    communicationDisabledUntil: null,
    timeoutReason: 'Unrestricted by bot command',
  });
}