/**
 * Telegram — unsendMessage
 *
 * Silently swallows errors because the message may have already been deleted,
 * fallen outside the 48-hour Bot API deletion window, or the bot may lack
 * admin rights in the chat — none of these should surface as a user-visible error.
 *
 * grammY's ctx.deleteMessage() shortcut always targets the message that triggered
 * the current update and takes no messageID argument, so an explicit target requires
 * the raw ctx.api.deleteMessage(chatId, messageId) call instead.
 */
import type { Context } from 'grammy';

export async function unsendMessage(
  ctx: Context,
  messageID: string,
): Promise<void> {
  try {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    await ctx.api.deleteMessage(chatId, Number(messageID));
  } catch {
    /* deletion failure is non-fatal */
  }
}
