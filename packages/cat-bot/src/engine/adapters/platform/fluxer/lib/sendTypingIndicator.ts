/**
 * Fluxer — sendTypingIndicator
 *
 * Fluxer's typing indicator is a fire-and-forget REST call that displays
 * "Bot is typing..." for a fixed window. It must be re-sent on an interval by
 * the caller to stay alive for the full duration of a long-running command —
 * this function only issues a single signal per call.
 */
import type { TextChannel, DMChannel } from '@fluxerjs/core';

export type FluxerTextChannel = TextChannel | DMChannel;

/** Narrow guard: only text/DM channels support sendTyping(). */
function canSendTyping(
  channel: FluxerTextChannel | null | undefined,
): channel is FluxerTextChannel {
  return typeof (channel as { sendTyping?: unknown } | null)?.sendTyping ===
    'function';
}

export async function sendTypingIndicator(
  channel: FluxerTextChannel | null | undefined,
): Promise<void> {
  if (!canSendTyping(channel)) return;
  await channel.sendTyping().catch(() => undefined);
}