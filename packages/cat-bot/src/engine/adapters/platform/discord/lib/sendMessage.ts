/**
 * Sends a text/attachment message via an abstract sendFn.
 * sendFn abstracts the interaction reply vs channel.send difference so both
 * DiscordApi (slash commands) and createDiscordChannelApi (message events)
 * share the same attachment-handling logic.
 *
 * attachment_url[] entries that look like images are sent as embeds referencing
 * the URL directly — Discord's own servers fetch the image for the preview, so
 * the bot never downloads it. Non-image URL attachments (video/audio/document)
 * have no server-side-fetch equivalent on Discord, so those are still downloaded
 * here and uploaded as a real file attachment, same as before.
 */
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import type { SendPayload } from '@/engine/adapters/models/api.model.js';
import { streamToBuffer, urlToBuffer } from '../utils/helper.util.js';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'];
const extOf = (nameOrUrl: string): string =>
  nameOrUrl.split('.').pop()?.split('?')[0]?.toLowerCase() ?? '';

type SendFn = (
  content: string,
  files: AttachmentBuilder[],
  embeds: EmbedBuilder[],
) => Promise<{ id: string } | undefined>;

export async function sendMessage(
  sendFn: SendFn,
  msg: string | SendPayload,
): Promise<string | undefined> {
  // Accept both direct string and SendPayload-style object with a `body` field
  const content =
    typeof msg === 'string'
      ? msg
      : (msg.message ?? (msg as unknown as { body?: string }).body ?? '');
  const files: AttachmentBuilder[] = [];
  const embeds: EmbedBuilder[] = [];

  if (typeof msg !== 'string') {
    const urlAttachments = msg.attachment_url ?? [];
    const imageUrls = urlAttachments.filter((a) => IMAGE_EXTS.includes(extOf(a.name || a.url)));
    const nonImageUrls = urlAttachments.filter((a) => !IMAGE_EXTS.includes(extOf(a.name || a.url)));

    // Image URLs → embeds, sent directly with zero bot-side download
    for (const { url } of imageUrls) embeds.push(new EmbedBuilder().setImage(url));

    // Build all AttachmentBuilders in parallel — stream buffering and non-image URL
    // downloads run concurrently so N attachments take ~max(individual times) instead of their sum.
    const [streamFiles, urlFiles] = await Promise.all([
      // Parallel: convert every stream/buffer attachment to a Discord AttachmentBuilder
      (async () => {
        if (!msg.attachment) return [];
        const items = Array.isArray(msg.attachment)
          ? msg.attachment
          : [{ name: (msg.attachment as unknown as { path?: string }).path || 'file.bin', stream: msg.attachment }];
        return Promise.all(
          items.map(async ({ name, stream }) => {
            const buf = Buffer.isBuffer(stream)
              ? stream
              : await streamToBuffer(stream as NodeJS.ReadableStream);
            return new AttachmentBuilder(buf, { name: name || 'file.bin' });
          }),
        );
      })(),
      // Parallel: download every non-image URL attachment directly into a buffer (single-pass arraybuffer)
      (async () => {
        if (!nonImageUrls.length) return [];
        return Promise.all(
          nonImageUrls.map(async ({ name, url }) => {
            const { buffer, filename } = await urlToBuffer(url, name);
            return new AttachmentBuilder(buffer, { name: filename });
          }),
        );
      })(),
    ]);
    files.push(...streamFiles, ...urlFiles);
  }
  const sent = await sendFn(content, files, embeds);
  return sent?.id;
}
