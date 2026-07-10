/**
 * Telegram — reactToMessage
 *
 * Uses Bot API 7.0+ setMessageReaction. Reaction type 'emoji' is the standard
 * non-paid emoji; paid reactions require a different type and are not handled here.
 */
import type { Context } from 'grammy';

export async function reactToMessage(
  ctx: Context,
  _threadID: string,
  messageID: string,
  emoji: string,
): Promise<void> {
  await ctx.api.setMessageReaction(
    ctx.chat?.id as number,
    Number(messageID),
    // @ts-expect-error grammY strongly types emojis; Cat-Bot passes string and relies on Telegram API validation
    [{ type: 'emoji' as const, emoji }],
  );
}
