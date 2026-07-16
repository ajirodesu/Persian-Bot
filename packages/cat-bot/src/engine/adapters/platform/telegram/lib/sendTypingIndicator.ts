/**
 * Telegram — sendTypingIndicator
 *
 * Uses the Bot API sendChatAction method with the 'typing' action. Telegram
 * clears the indicator after ~5 seconds, so the caller is responsible for
 * re-sending it on an interval for the duration of a long-running command —
 * this function only issues a single signal per call.
 */
import type { Context } from 'grammy';

export async function sendTypingIndicator(
  ctx: Context,
  threadID: string,
): Promise<void> {
  const chatId = Number(threadID) || ctx.chat?.id;
  if (!chatId) return;
  await ctx.api.sendChatAction(chatId, 'typing');
}
