/**
 * Telegram — getBotID
 *
 * PERF: grammY does not auto-cache getMe() on the Context, so calling this on
 * every onEvent/onCommand invocation used to cost a full Telegram Bot API round
 * trip (~50-300ms) EVERY time any handler needed the bot's own ID — which is
 * nearly every command and event (see ai.ts, welcome.ts, goodbye.ts, checkwarn.ts).
 * The bot's own ID never changes for the lifetime of a session, so it's cached
 * here per-Api-instance (one grammY `Api` object per running Telegram session)
 * after the first resolution. listener.ts primes this cache at boot using the
 * getMe() call it already makes to validate the token — so in the common case
 * getBotID() never hits the network at all during the session's lifetime.
 */
import type { Context, Api } from 'grammy';

const botIdCache = new WeakMap<Api, string>();

/**
 * Seeds the cache with an already-known bot ID (called once from listener.ts
 * boot(), reusing the getMe() result it fetches anyway to validate the token —
 * avoids a second redundant getMe() round trip on the very first event).
 */
export function primeBotID(api: Api, id: string | number): void {
  botIdCache.set(api, String(id));
}

export async function getBotID(ctx: Context): Promise<string> {
  const cached = botIdCache.get(ctx.api);
  if (cached) return cached;
  const me = await ctx.api.getMe();
  const id = String(me.id);
  botIdCache.set(ctx.api, id);
  return id;
}