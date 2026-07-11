/**
 * Telegram — getBotID
 *
 * grammY's Context does not expose a per-update cached bot-identity getter —
 * botInfo caching lives on the Bot instance, not on individual update contexts.
 * Calling ctx.api.getMe() here always resolves the correct bot ID with a single
 * lightweight Bot API round-trip.
 */
import type { Context } from 'grammy';

export async function getBotID(ctx: Context): Promise<string> {
  const me = await ctx.api.getMe();
  return String(me.id);
}
