/**
 * Discord — sendTypingIndicator
 *
 * Discord's typing indicator is a fire-and-forget REST call that displays
 * "Bot is typing..." for ~10 seconds. It must be re-sent on an interval by the
 * caller to stay alive for the full duration of a long-running command — this
 * function only issues a single signal per call.
 */
import type { TextBasedChannel } from 'discord.js';

/** Narrow guard: some TextBasedChannel variants (e.g. PartialGroupDMChannel) lack sendTyping(). */
type TypingCapableChannel = TextBasedChannel & { sendTyping: () => Promise<void> };

function canSendTyping(
  channel: TextBasedChannel,
): channel is TypingCapableChannel {
  return typeof (channel as { sendTyping?: unknown }).sendTyping === 'function';
}

export async function sendTypingIndicator(
  channel: TextBasedChannel | null | undefined,
): Promise<void> {
  if (!channel || !canSendTyping(channel)) return;
  await channel.sendTyping();
}
