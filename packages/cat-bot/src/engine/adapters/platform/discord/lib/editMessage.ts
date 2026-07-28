/**
 * Edits the body of a bot-sent Discord message.
 * Only the bot's own messages are editable — attempting to edit another user's
 * message will throw a DiscordAPIError with code 50005.
 */
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
  type MessageEditOptions,
  type TextChannel,
} from 'discord.js';
import type { EditMessageOptions } from '@/engine/adapters/models/api.model.js';
import { streamToBuffer, urlToBuffer } from '../utils/helper.util.js';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'];
const extOf = (nameOrUrl: string): string =>
  nameOrUrl.split('.').pop()?.split('?')[0]?.toLowerCase() ?? '';

export async function editMessage(
  channel: TextChannel,
  messageID: string,
  options: string | EditMessageOptions,
): Promise<void> {
  if (!channel) throw new Error('Channel not available for editing.');
  // No direct channel.editMessage() in discord.js — must fetch the Message object first
  const msg = await channel.messages.fetch(messageID);

  // Safely extract the text string from both string and unified SendPayload shapes —
  // SendPayload.message may itself be a nested object when callers forward raw payloads.
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

  const style = typeof options === 'object' ? options.style : undefined;
  const finalContent = style === 'text' ? escapeMarkdown(content) : content;

  // Use discord.js MessageEditOptions for type-safe payload construction —
  // replaces the previous Record<string,unknown> cast to Parameters<typeof msg.edit>[0]
  // which silently bypassed TypeScript's structural checks on the discord.js API surface.
  const payload: MessageEditOptions = { content: finalContent };
  const button = typeof options === 'object' ? options.button : undefined;

  // Process attachment arrays exactly like replyMessage.ts does on the initial send:
  // image URLs become embeds (Discord fetches the preview itself, no bot-side download),
  // everything else (stream attachments, non-image URLs) becomes a real file attachment.
  //
  // THE ACTUAL BUG: the initial send from replyMessage.ts puts image URLs into an EMBED,
  // not a file attachment. This edit path was building a real file attachment for every
  // photo instead of matching that embed behavior, and — just as importantly — never told
  // Discord to drop the OLD embed. Discord's message.edit() retains any field you don't
  // explicitly set, so the old embed image stayed on the message while a brand-new file
  // attachment got added next to it: two images on one message, i.e. the "stuck duplicate"
  // photo. The fix has two parts: (1) mirror the embed behavior so we're replacing like
  // with like, and (2) whenever new photo content comes in, always set BOTH `embeds` and
  // `attachments` (even to `[]`) so whichever one held the previous photo gets cleared.
  const attachment =
    typeof options === 'object' ? options.attachment : undefined;
  const attachmentUrl =
    typeof options === 'object' ? options.attachment_url : undefined;
  const hasNewPhotoContent = !!(attachment?.length || attachmentUrl?.length);

  const files: AttachmentBuilder[] = [];
  const embeds: EmbedBuilder[] = [];

  if (attachment?.length) {
    for (const { name, stream } of attachment) {
      const buf = Buffer.isBuffer(stream)
        ? stream
        : await streamToBuffer(stream as NodeJS.ReadableStream);
      files.push(new AttachmentBuilder(buf, { name: name || 'file.bin' }));
    }
  }
  if (attachmentUrl?.length) {
    const imageUrls = attachmentUrl.filter((a) => IMAGE_EXTS.includes(extOf(a.name || a.url)));
    const nonImageUrls = attachmentUrl.filter((a) => !IMAGE_EXTS.includes(extOf(a.name || a.url)));

    for (const { url } of imageUrls) embeds.push(new EmbedBuilder().setImage(url));

    for (const { name, url } of nonImageUrls) {
      const { buffer, filename } = await urlToBuffer(url, name);
      files.push(new AttachmentBuilder(buffer, { name: filename }));
    }
  }

  if (hasNewPhotoContent) {
    // Set every time new photo content arrives — even as an empty array — so whichever
    // field (embeds or attachments) carried the previous photo is explicitly cleared
    // rather than silently retained by Discord's edit-preserves-unset-fields default.
    payload.files = files;
    payload.attachments = [];
    payload.embeds = embeds;
  }

  // Convert Unified ButtonItems into Discord ActionRowBuilders.
  // Explicit undefined check (not truthiness) so an empty array [] correctly clears
  // all components — `if ([])` is truthy but the intent is "caller provided buttons".
  if (button !== undefined) {
    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (button.length > 0) {
      const STYLE_MAP: Record<string, ButtonStyle> = {
        primary: ButtonStyle.Primary,
        secondary: ButtonStyle.Secondary,
        success: ButtonStyle.Success,
        danger: ButtonStyle.Danger,
      };
      // Each inner array is one ActionRow — matches the 2-D ButtonItem[][] contract from EditMessageOptions.
      // Preserves the caller's explicit row grouping so grids and mixed layouts survive edits unchanged.
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
    payload.components = components;
  }

  await msg.edit(payload);
}
