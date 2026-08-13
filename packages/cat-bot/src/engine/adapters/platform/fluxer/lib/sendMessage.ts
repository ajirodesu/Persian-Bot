/**
 * Sends a text/attachment message via an abstract sendFn.
 * sendFn abstracts the channel.send difference so the wrapper shares the same
 * attachment-handling logic regardless of the channel type.
 *
 * attachment_url[] entries that look like images are sent as embeds referencing
 * the URL directly — the Fluxer CDN fetches the image for the preview, so the
 * bot never downloads it. Non-image URL attachments are passed to the SDK as
 * URL files ({ name, url }) — the SDK fetches them server-side. Stream/buffer
 * attachments are converted to buffers and uploaded as file data.
 */
import { EmbedBuilder } from '@fluxerjs/core';
import type { SendPayload } from '@/engine/adapters/models/api.model.js';
import { streamToBuffer } from '../utils/helper.util.js';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'];
const extOf = (nameOrUrl: string): string =>
  nameOrUrl.split('.').pop()?.split('?')[0]?.toLowerCase() ?? '';

/** File payload accepted by the SDK MessageSendOptions.files array. */
export type FluxerFile =
  | { name: string; data: ArrayBuffer | Uint8Array | Buffer; filename?: string }
  | { name: string; url: string; filename?: string };

type FluxerSendFn = (
  content: string,
  files: FluxerFile[],
  embeds: EmbedBuilder[],
) => Promise<{ id: string } | undefined>;

export async function sendMessage(
  sendFn: FluxerSendFn,
  msg: string | SendPayload,
): Promise<string | undefined> {
  // Accept both direct string and SendPayload-style object with a `body` field
  const content =
    typeof msg === 'string'
      ? msg
      : (msg.message ?? (msg as unknown as { body?: string }).body ?? '');
  const files: FluxerFile[] = [];
  const embeds: EmbedBuilder[] = [];

  if (typeof msg !== 'string') {
    const urlAttachments = msg.attachment_url ?? [];
    const imageUrls = urlAttachments.filter((a) =>
      IMAGE_EXTS.includes(extOf(a.name || a.url)),
    );
    const nonImageUrls = urlAttachments.filter(
      (a) => !IMAGE_EXTS.includes(extOf(a.name || a.url)),
    );

    // Image URLs → embeds, sent directly with zero bot-side download
    for (const { url } of imageUrls) embeds.push(new EmbedBuilder().setImage(url));

    // Build all files in parallel — stream buffering and URL forwarding run
    // concurrently so N attachments take ~max(individual times) instead of their sum.
    if (msg.attachment) {
      const items = Array.isArray(msg.attachment)
        ? msg.attachment
        : [
            {
              name: (msg.attachment as unknown as { path?: string }).path ||
                'file.bin',
              stream: msg.attachment,
            },
          ];
      const streamFiles = await Promise.all(
        items.map(async ({ name, stream }) => {
          const data = Buffer.isBuffer(stream)
            ? stream
            : await streamToBuffer(stream as NodeJS.ReadableStream);
          return { name: name || 'file.bin', data } satisfies FluxerFile;
        }),
      );
      files.push(...streamFiles);
    }
    for (const { name, url } of nonImageUrls) {
      // SDK fetches URL files server-side — never download in the bot
      files.push({ name: name || 'file.bin', url });
    }
  }
  const sent = await sendFn(content, files, embeds);
  return sent?.id;
}