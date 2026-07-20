/**
 * Discord — restrictUser / unrestrictUser
 *
 * Discord has no permission-scoped "mute" concept identical to Telegram's
 * restrictChatMember — the closest native equivalent is a member Timeout
 * (`communication_disabled_until`), which strips the ability to send
 * messages/react/join voice for a bounded period without removing the
 * member from the server. Discord caps a single timeout at 28 days
 * (2,419,200,000 ms); requests beyond that are clamped rather than rejected,
 * since a clamped-but-successful restriction is more useful than an error.
 *
 * Requires the bot's role to sit above the target member's highest role in
 * the server's role hierarchy, and the MODERATE_MEMBERS permission.
 */
import type { Guild } from 'discord.js';

/** Discord's hard ceiling on a single timeout duration. */
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

export async function restrictUser(
  guild: Guild | null,
  userID: string,
  durationMs?: number,
): Promise<void> {
  if (!guild) throw new Error('Not in a server.');
  const member = await guild.members.fetch(userID);
  const ms = Math.min(durationMs ?? MAX_TIMEOUT_MS, MAX_TIMEOUT_MS);
  await member.timeout(ms, 'Restricted by bot command');
}

export async function unrestrictUser(
  guild: Guild | null,
  userID: string,
): Promise<void> {
  if (!guild) throw new Error('Not in a server.');
  const member = await guild.members.fetch(userID);
  // Passing null clears an active timeout immediately.
  await member.timeout(null, 'Unrestricted by bot command');
}
