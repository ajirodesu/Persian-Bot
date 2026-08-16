/**
 * Sends a message with optional attachment arrays and reply threading via an
 * abstract sendFn. reply_to_message_id is forwarded to sendFn — the wrapper
 * passes it into the SDK replyTo target when present.
 *
 * Fluxer has no button components — the button[][] argument is ignored by the
 * wrapper and this lib simply forwards the embeds/files. Image URLs → embeds
 * (server-side fetch, zero bot download); stream/buffer + non-image URLs → files.
 */
import { EmbedBuilder } from '@fluxerjs/core';
import type { SendPayload } from '@/engine/adapters/models/api.model.js';
import type { MessageStyleValue } from '@/engine/constants/message-style.constants.js';
import { streamToBuffer } from '../utils/helper.util.js';
import type { FluxerFile } from './sendMessage.js';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'];
const extOf = (nameOrUrl: string): string =>
  nameOrUrl.split(/[?#]/)[0]?.split('.').pop()?.toLowerCase() ?? '';

// Route by the URL's own extension when the name doesn't carry a known image
// extension — a .gif URL with a generic/empty name must still render as an
// (animated) image embed, never as a downloaded file.
const isImageUrl = (a: { name?: string; url: string }): boolean =>
  IMAGE_EXTS.includes(
    extOf(a.name && IMAGE_EXTS.includes(extOf(a.name)) ? a.name : a.url),
  );

type FluxerReplyFn = (
  content: string,
  files: FluxerFile[],
  replyId?: string,
  embeds?: EmbedBuilder[],
) => Promise<string | undefined>;

interface ReplyOptions {
  message?: string | SendPayload;
  attachment?: Array<{ name: string; stream: NodeJS.ReadableStream | Buffer }>;
  attachment_url?: Array<{ name: string; url: string }>;
  reply_to_message_id?: string;
  style?: MessageStyleValue;
}

export async function replyMessage(
  sendFn: FluxerReplyFn,
  {
    message: msgBody = '',
    attachment = [],
    attachment_url = [],
    reply_to_message_id,
    style,
  }: ReplyOptions = {},
): Promise<string | undefined> {
  const content =
    typeof msgBody === 'string'
      ? msgBody
      : (msgBody.message ??
        (msgBody as unknown as { body?: string })?.body ??
        '');

  const files: FluxerFile[] = [];
  const embeds: EmbedBuilder[] = [];

  const imageUrls = attachment_url.filter(isImageUrl);
  const nonImageUrls = attachment_url.filter(
    (a) => !isImageUrl(a),
  );

  // Image URLs → embeds, sent directly with zero bot-side download
  for (const { url } of imageUrls) embeds.push(new EmbedBuilder().setImage(url));

  // Stream/buffer attachments → buffered file data; non-image URLs → SDK-side fetch
  const [streamFiles] = await Promise.all([
    Promise.all(
      attachment.map(async ({ name, stream }) => {
        const data = Buffer.isBuffer(stream)
          ? stream
          : await streamToBuffer(stream as NodeJS.ReadableStream);
        return { name: name || 'file.bin', data } satisfies FluxerFile;
      }),
    ),
  ]);
  files.push(...streamFiles);
  for (const { name, url } of nonImageUrls) {
    files.push({ name: name || 'file.bin', url });
  }

  void style; // Fluxer renders native markdown; 'text' escaping left to consumers
  return sendFn(content, files, reply_to_message_id, embeds);
}