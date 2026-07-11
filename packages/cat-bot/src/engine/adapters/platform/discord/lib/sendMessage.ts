/**
 * Sends a text/attachment message via an abstract sendFn.
 * sendFn abstracts the interaction reply vs channel.send difference so both
 * DiscordApi (slash commands) and createDiscordChannelApi (message events)
 * share the same attachment-handling logic.
 */
import { AttachmentBuilder } from 'discord.js';
import type { SendPayload } from '@/engine/adapters/models/api.model.js';
import { streamToBuffer, urlToStream } from '../utils/helper.util.js';

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
    // Align with Unified SendPayload contract allowing NamedStreamAttachment[] arrays.
    // Each entry converts independently, so Promise.all runs the I/O concurrently instead
    // of serialising N stream/network reads one at a time (see replyMessage.ts for the
    // same fix with more detail).
    if (msg.attachment) {
      if (Array.isArray(msg.attachment)) {
        const streamFiles = await Promise.all(
          msg.attachment.map(async ({ name, stream }) => {
            const buf = Buffer.isBuffer(stream)
              ? stream
              : await streamToBuffer(stream as NodeJS.ReadableStream);
            return new AttachmentBuilder(buf, { name: name || 'file.bin' });
          }),
        );
        files.push(...streamFiles);
      } else {
        const stream = msg.attachment;
        const buf = Buffer.isBuffer(stream)
          ? stream
          : await streamToBuffer(stream as NodeJS.ReadableStream);
        files.push(
          new AttachmentBuilder(buf, {
            name: (stream as unknown as { path?: string }).path || 'file.bin',
          }),
        );
      }
    }
    // Support unified NamedUrlAttachment[] arrays identical to replyMessage
    if (msg.attachment_url) {
      const urlFiles = await Promise.all(
        msg.attachment_url.map(async ({ name, url }) => {
          const s = await urlToStream(url, name);
          const buf = await streamToBuffer(s);
          return new AttachmentBuilder(buf, {
            name:
              name || (s as unknown as { path?: string }).path || 'file.bin',
          });
        }),
      );
      files.push(...urlFiles);
    }
  }
  const sent = await sendFn(content, files);
  return sent?.id;
}
