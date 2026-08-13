/**
 * Edits the body (and/or embed image URLs) of a bot-sent Fluxer message.
 * Only the bot's own messages are editable — attempting to edit another user's
 * message will throw a FluxerError.
 *
 * The Fluxer SDK MessageEditOptions does not support inline file uploads (it
 * only accepts already-uploaded attachment metadata), so stream attachments are
 * not editable on Fluxer. Image URL attachments are applied as embeds, matching
 * the initial-send path in sendMessage.
 */
import { EmbedBuilder } from '@fluxerjs/core';
import type { MessageManager } from '@fluxerjs/core';
import type { EditMessageOptions } from '@/engine/adapters/models/api.model.js';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'];
const extOf = (nameOrUrl: string): string =>
  nameOrUrl.split('.').pop()?.split('?')[0]?.toLowerCase() ?? '';

export async function editMessage(
  messages: MessageManager,
  messageID: string,
  options: string | EditMessageOptions,
): Promise<void> {
  const msg = await messages.fetch(messageID);

  if (typeof options !== 'string' && (options.attachment?.length ?? 0) > 0) {
    // No SDK-native inline-upload edit path — surface a clear error.
    throw new Error(
      'editMessage with stream attachments is not supported on Fluxer.',
    );
  }

  let content: string;
  if (typeof options === 'string') {
    content = options;
  } else {
    const rawMsg = options.message;
    content =
      typeof rawMsg === 'string'
        ? rawMsg
        : ((rawMsg as { message?: string } | undefined)?.message ??
          (rawMsg as { body?: string } | undefined)?.body ??
          '');
  }

  const embeds: EmbedBuilder[] = [];
  if (typeof options !== 'string') {
    for (const { name, url } of options.attachment_url ?? []) {
      if (IMAGE_EXTS.includes(extOf(name || url))) {
        embeds.push(new EmbedBuilder().setImage(url));
      }
    }
  }

  await msg.edit({
    content,
    ...(embeds.length > 0 ? { embeds } : {}),
  });
}