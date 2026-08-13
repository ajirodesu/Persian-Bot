/**
 * Reacts to a Fluxer message with an emoji.
 * Reacts to the raw message when available (zero REST) or fetches it first.
 */
import type { MessageManager, Message } from '@fluxerjs/core';

/**
 * @param messages - MessageManager of the target channel (channel.messages)
 * @param messageID - Snowflake of the message to react to
 * @param emoji - Emoji string (unicode or `name:id` for custom emojis)
 * @param rawMessage - The cached Message object to react to without a REST fetch
 */
export async function reactToMessage(
  messages: MessageManager,
  messageID: string,
  emoji: string,
  rawMessage: Message | null = null,
): Promise<void> {
  const message = rawMessage?.id === messageID ? rawMessage : await messages.fetch(messageID);
  await message.react(emoji);
}