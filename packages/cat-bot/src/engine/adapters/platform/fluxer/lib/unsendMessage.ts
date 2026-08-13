/**
 * Removes (deletes) a bot-sent Fluxer message from a channel.
 * Only the bot's own messages are deletable — attempting to delete another
 * user's message will throw a FluxerError.
 */
import type { MessageManager } from '@fluxerjs/core';

/**
 * @param messages - MessageManager of the target channel (channel.messages)
 * @param messageID - Snowflake of the message to delete
 */
export async function unsendMessage(
  messages: MessageManager,
  messageID: string,
): Promise<void> {
  const message = await messages.fetch(messageID);
  await message.delete();
}