/**
 * Sends a text/attachment message via an abstract sendFn.
 * sendFn abstracts the interaction reply vs channel.send difference so both
 * DiscordApi (slash commands) and createDiscordChannelApi (message events)
 * share the same attachment-handling logic.
 */
import { AttachmentBuilder } from 'discord.js';
import type { SendPayload } from '@/engine/adapters/models/api.model.js';
import { streamToBuffer, urlToBuffer } from '../utils/helper.util.js';

type SendFn = (
  content: string,
  files: AttachmentBuilder[],
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

  if (typeof msg !== 'string') {
    // Build all AttachmentBuilders in parallel — stream buffering and URL downloads
    // run concurrently so N attachments take ~max(individual times) instead of their sum.
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
      // Parallel: download every URL attachment directly into a buffer (single-pass arraybuffer)
      (async () => {
        if (!msg.attachment_url) return [];
        return Promise.all(
          msg.attachment_url.map(async ({ name, url }) => {
            const { buffer, filename } = await urlToBuffer(url, name);
            return new AttachmentBuilder(buffer, { name: filename });
          }),
        );
      })(),
    ]);
    files.push(...streamFiles, ...urlFiles);
  }
  const sent = await sendFn(content, files);
  return sent?.id;
}
