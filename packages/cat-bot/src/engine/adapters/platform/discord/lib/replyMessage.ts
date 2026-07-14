/**
 * Sends a message with optional attachment arrays via the abstract sendFn.
 * reply_to_message_id is forwarded to sendFn — the interaction path silently ignores it
 * (slash command interactions reply via editReply/followUp, not message references),
 * while the channel path creates a Discord quote-thread link.
 */
import {
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  escapeMarkdown,
} from 'discord.js';
import type { SendPayload } from '@/engine/adapters/models/api.model.js';
import type { ButtonItem } from '@/engine/adapters/models/api.model.js';
import type { MessageStyleValue } from '@/engine/constants/message-style.constants.js';
import { streamToBuffer, urlToBuffer } from '../utils/helper.util.js';

type SendFn = (
  content: string,
  files: AttachmentBuilder[],
  replyId?: string,
  components?: ActionRowBuilder<ButtonBuilder>[],
) => Promise<string | undefined>;

interface ReplyOptions {
  message?: string | SendPayload;
  attachment?: Array<{ name: string; stream: NodeJS.ReadableStream | Buffer }>;
  attachment_url?: Array<{ name: string; url: string }>;
  reply_to_message_id?: string;
  button?: ButtonItem[][];
  style?: MessageStyleValue;
}

export async function replyMessage(
  sendFn: SendFn,
  {
    message: msgBody = '',
    attachment = [],
    attachment_url = [],
    reply_to_message_id,
    button = [],
    style,
  }: ReplyOptions = {},
): Promise<string | undefined> {
  // Guard: Discord rejects messages that combine multiple attachments with button components
  // (ActionRows). A single stream attachment OR a single URL attachment alongside buttons is
  // the only permitted combination. Two or more attachment slots — regardless of type mix —
  // must be sent without buttons. This matches Discord API behaviour: button rows are silently
  // dropped when files array length > 1, so we surface the constraint as an explicit error.
  const totalAttachCount = attachment.length + attachment_url.length;
  if (button.length > 0 && totalAttachCount > 1) {
    throw new Error(
      `Discord only supports 1 attachment alongside button components (ActionRows). ` +
        `Received ${attachment.length} stream attachment(s) and ${attachment_url.length} URL attachment(s). ` +
        `Reduce to a maximum of 1 total attachment when using buttons.`,
    );
  }
  // Accept both direct string and SendPayload-style object with a `body` field
  const content =
    typeof msgBody === 'string'
      ? msgBody
      : (msgBody.message ??
        (msgBody as unknown as { body?: string })?.body ??
        '');
  // Discord renders markdown by default; when the caller requests raw text, escape
  // all Discord-flavored markdown syntax so characters like * _ ~ | display literally.
  // style='markdown' (or omitted) passes through unchanged — Discord auto-renders.
  const finalContent = style === 'text' ? escapeMarkdown(content) : content;
  const files: AttachmentBuilder[] = [];

  // Build all AttachmentBuilders in parallel — stream buffering and URL downloads
  // run concurrently so N attachments take ~max(individual times) instead of their sum.
  const [streamFiles, urlFiles] = await Promise.all([
    // Parallel: convert every stream/buffer attachment to a Discord AttachmentBuilder
    Promise.all(
      attachment.map(async ({ name, stream }) => {
        const buf = Buffer.isBuffer(stream)
          ? stream
          : await streamToBuffer(stream as NodeJS.ReadableStream);
        return new AttachmentBuilder(buf, { name: name || 'file.bin' });
      }),
    ),
    // Parallel: download every URL attachment directly into a buffer (single-pass arraybuffer,
    // no intermediate PassThrough stream) and wrap in an AttachmentBuilder
    Promise.all(
      attachment_url.map(async ({ name, url }) => {
        const { buffer, filename } = await urlToBuffer(url, name);
        return new AttachmentBuilder(buffer, { name: filename });
      }),
    ),
  ]);
  files.push(...streamFiles, ...urlFiles);

  // Map unified ButtonItem style strings to Discord ButtonStyle enum values.
  const STYLE_MAP: Record<string, ButtonStyle> = {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger,
  };
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  // Each inner array is one Discord ActionRow — the caller controls layout via the 2-D structure.
  // [btn1, btn2]        → single row; [[btn1],[btn2]] → two rows (vertical);
  // [[btn1,btn2],[btn3]] → mixed rows. Discord allows max 5 buttons per row, 5 rows per message.
  if (button.length > 0) {
    for (const rowItems of button) {
      const row = new ActionRowBuilder<ButtonBuilder>();
      for (const btn of rowItems) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(btn.id)
            .setLabel(btn.label)
            .setStyle(
              STYLE_MAP[btn.style ?? 'secondary'] ?? ButtonStyle.Secondary,
            ),
        );
      }
      components.push(row);
    }
  }

  return sendFn(finalContent, files, reply_to_message_id, components);
}
