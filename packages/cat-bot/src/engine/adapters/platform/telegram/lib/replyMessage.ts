/**
 * Telegram — replyMessage
 *
 * Routes attachments to the correct Bot API method by .path extension:
 *   photos → sendMediaGroup (single album call, up to 10)
 *   gifs   → sendAnimation (sendMediaGroup cannot mix animation + photo types)
 *   audio  → sendVoice (sequential; no sendVoiceGroup in Bot API)
 *   others → sendDocument
 *
 * reply_to_message_id wires reply_parameters so Telegram threads the message
 * to the original. Caption appears on the first photo of a media group only —
 * Telegram displays one caption per group.
 */
import type { Context } from 'grammy';
import { InputFile } from 'grammy';
import type { MessageEntity } from 'grammy/types';
import {
  streamToBuffer,
  urlToBuffer,
} from '@/engine/utils/streams.util.js';
// text_mention entities allow tagging users by numeric ID without a public @username — Bot API 7.0+
import { buildTelegramMentionEntities } from '../utils/helper.util.js';
import { sanitizeMarkdownV2 } from '../utils/markdownv2.util.js';
import type { ReplyMessageOptions } from '@/engine/adapters/models/api.model.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { sendRichMessage } from './sendRichMessage.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

export async function replyMessage(
  ctx: Context,
  _threadID: string,
  {
    message: msgBody = '',
    attachment = [],
    attachment_url = [],
    reply_to_message_id,
    button = [],
    mentions = [],
    style,
    rich,
  }: ReplyMessageOptions = {},
): Promise<string | undefined> {
  // ── Rich Message dispatch (Bot API 10.1+ InputRichMessage) ─────────────────
  // Routed before the legacy attachment/MarkdownV2 pipeline entirely — rich
  // messages carry their own inline-media syntax (markdown/html/blocks) and
  // Bot API 10.2's InputRichMessageMedia field, so they don't share the
  // stream/URL attachment-buffering path below. If stream/URL attachments are
  // supplied alongside a rich style, they're dropped with a warning rather than
  // silently mixed into a request shape InputRichMessage doesn't support —
  // callers should use `rich.media` (InputRichMessageMedia) instead.
  if (style === MessageStyle.RICH_MARKDOWN || style === MessageStyle.RICH_HTML) {
    if (attachment.length > 0 || attachment_url.length > 0) {
      logger.debug(
        '[telegram] replyMessage: stream/URL attachments are ignored for rich styles — use rich.media instead',
        { attachmentCount: attachment.length, urlCount: attachment_url.length },
      );
    }
    const text =
      typeof msgBody === 'string'
        ? msgBody
        : ((msgBody as { message?: string })?.message ??
          (msgBody as { body?: string })?.body ??
          '');
    return sendRichMessage(ctx, _threadID, {
      ...(style === MessageStyle.RICH_MARKDOWN
        ? { markdown: text }
        : { html: text }),
      ...(rich?.blocks
        ? { blocks: rich.blocks as unknown as import('./rich-message.types.js').InputRichBlock[] }
        : {}),
      ...(rich?.isRtl !== undefined ? { isRtl: rich.isRtl } : {}),
      ...(rich?.skipEntityDetection !== undefined
        ? { skipEntityDetection: rich.skipEntityDetection }
        : {}),
      ...(rich?.media ? { media: rich.media } : {}),
      ...(reply_to_message_id ? { reply_to_message_id } : {}),
      button,
    });
  }

  // Guard: Telegram's sendMediaGroup API silently ignores reply_markup (inline keyboards)
  // when the message carries multiple media items. Rather than silently stripping buttons,
  // we reject the combination here so callers receive a clear constraint violation instead
  // of delivering a message that looks correct but has no interactive components attached.
  const totalAttachCount = attachment.length + attachment_url.length;
  if (button.length > 0 && totalAttachCount > 1) {
    throw new Error(
      `Telegram only supports 1 attachment alongside button components (inline keyboard). ` +
        `Received ${attachment.length} stream attachment(s) and ${attachment_url.length} URL attachment(s). ` +
        `Reduce to a maximum of 1 total attachment when using buttons.`,
    );
  }
  // Use the explicit _threadID when it resolves to a non-zero number so the bot
  // can send to a different chat (admin DM, support group) than the one that
  // triggered the current update.  Falls back to ctx.chat?.id for the standard
  // same-chat reply path.
  const chatId = Number(_threadID) || (ctx.chat?.id as number);
  // `let` — sanitizeMarkdownV2 may reassign; avoids scattering a safeText alias through all send paths
  let text =
    typeof msgBody === 'string'
      ? msgBody
      : // Fallback matches SendPayload explicitly to prevent dropping `message` vs `body` payloads
        ((msgBody as { message?: string })?.message ??
        (msgBody as { body?: string })?.body ??
        '');

  // Hoist parseMode before entities — entity byte-offsets must be computed against the final
  // string Telegram actually receives, so sanitisation must happen first.
  // Legacy 'Markdown' mode is intentionally not used — Telegram officially deprecated it.
  const parseMode =
    style === MessageStyle.MARKDOWN ? ('MarkdownV2' as const) : undefined;

  // Escape bare MarkdownV2 reserved characters before computing mention entity offsets.
  // The 18 reserved chars (_ * [ ] ( ) ~ ` > # + - = | { } . !) cause 400 Bot API errors
  // when unescaped. sanitizeMarkdownV2 skips chars already preceded by '\' (valid escape
  // sequences), so intentional formatting like *bold* and _italic_ is preserved.
  // Mutation here means all downstream send paths (sendMessage, sendMediaGroup captions,
  // sendDocument, the button keyboard message) automatically use the corrected string
  // without per-call guards, and text_mention entities align with what Telegram parses.
  // Always sanitize — sanitizeMarkdownV2 is idempotent, so running on already-valid
  // text is a no-op. This avoids the double-call from the old validate-then-sanitize gate.
  if (parseMode === 'MarkdownV2') text = sanitizeMarkdownV2(text);

  // Compute text_mention entities once for all send calls in this invocation.
  // Entities are computed against `text` AFTER sanitisation so byte-offsets align with
  // what Telegram receives — inserting '\' shifts positions and would misplace highlights.
  // textExtra uses 'entities'; captionExtra uses 'caption_entities' — Telegram distinguishes
  // these two fields and silently ignores 'entities' on media (sendMediaGroup, sendDocument).
  const entities = buildTelegramMentionEntities(text, mentions);
  const replyExtra = reply_to_message_id
    ? { reply_parameters: { message_id: Number(reply_to_message_id) } }
    : {};
  const textExtra = {
    ...replyExtra,
    ...(entities.length ? { entities } : {}),
    ...(parseMode !== undefined ? { parse_mode: parseMode } : {}),
  };
  const captionExtra = {
    ...replyExtra,
    ...(entities.length
      ? { caption_entities: entities as MessageEntity[] }
      : {}),
    ...(parseMode !== undefined ? { parse_mode: parseMode } : {}),
  };

  // Build Telegram InlineKeyboardMarkup when buttons are requested.
  // Telegram callback_data is capped at 64 bytes — the "commandName:buttonId" format
  // is compact, but we slice defensively to avoid the Bot API rejecting longer IDs.
  const replyMarkup =
    button.length > 0
      ? {
          // Outer array = rows, inner array = buttons per row — matches Telegram Bot API InlineKeyboardButton[][]
          inline_keyboard: button.map((row) =>
            row.map((btn) => ({
              text: btn.label,
              callback_data: btn.id.slice(0, 64),
            })),
          ),
        }
      : undefined;

  // ── Pre-buffer ALL attachments in parallel ────────────────────────────────
  // urlToBuffer uses arraybuffer mode — a true single-pass download: Axios writes
  // directly into a contiguous ArrayBuffer with no intermediate PassThrough stream
  // and no secondary streamToBuffer pass.  All URL downloads AND stream reads run
  // concurrently inside one Promise.all so the entire pre-load phase costs
  // ≈ max(individual download times) instead of their sequential sum.
  type Buffered = { buffer: Buffer; filename: string };

  const [urlBuffered, streamBuffered] = await Promise.all([
    Promise.all(
      attachment_url.map(({ name, url }) => urlToBuffer(url, name)),
    ),
    Promise.all(
      attachment.map(async ({ name, stream }): Promise<Buffered> => ({
        buffer: Buffer.isBuffer(stream)
          ? stream
          : await streamToBuffer(stream as import('stream').Readable),
        filename: name,
      })),
    ),
  ]);

  // stream attachments first (preserves caller ordering), URL attachments after
  const allAttachments: Buffered[] = [...streamBuffered, ...urlBuffered];

  if (allAttachments.length === 0) {
    const sent = await ctx.api.sendMessage(chatId, text || ' ', {
      ...textExtra,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    return String(sent.message_id);
  }

  // Extension-based media-type routing — operates on the pre-buffered filename
  const extOf = ({ filename }: Buffered): string =>
    filename.split('.').pop()?.toLowerCase() ?? '';

  const photos = allAttachments.filter((a) =>
    ['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(extOf(a)),
  );
  const gifs    = allAttachments.filter((a) => extOf(a) === 'gif');
  const audios  = allAttachments.filter((a) =>
    ['mp3', 'ogg', 'wav', 'aac', 'opus', 'm4a'].includes(extOf(a)),
  );
  const videos  = allAttachments.filter((a) =>
    ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(extOf(a)),
  );
  const others  = allAttachments.filter(
    (a) =>
      !photos.includes(a) &&
      !gifs.includes(a) &&
      !audios.includes(a) &&
      !videos.includes(a),
  );

  // Single attachment + buttons: send methods natively support reply_markup. sendMediaGroup never
  // does — the Bot API simply ignores the field. Routing single-attachment+button cases
  // through their dedicated methods collapses both the attachment and buttons into one message.
  if (allAttachments.length === 1 && replyMarkup) {
    const { buffer, filename } = allAttachments[0]!;
    const commonExtra = {
      ...(text ? { caption: text } : {}),
      ...captionExtra,
      reply_markup: replyMarkup,
    };
    // Buffers are already in memory — InputFile wraps them directly, no more awaits here
    let sent;
    if (photos.length === 1) {
      sent = await ctx.api.sendPhoto(chatId, new InputFile(buffer, filename || 'photo.jpg'), commonExtra);
    } else if (videos.length === 1) {
      sent = await ctx.api.sendVideo(chatId, new InputFile(buffer, filename || 'video.mp4'), commonExtra);
    } else if (gifs.length === 1) {
      sent = await ctx.api.sendAnimation(chatId, new InputFile(buffer, filename || 'animation.gif'), commonExtra);
    } else if (audios.length === 1) {
      // Use sendAudio instead of sendVoice: Telegram's editMessageMedia cannot mutate Voice messages.
      sent = await ctx.api.sendAudio(chatId, new InputFile(buffer, filename || 'audio.mp3'), commonExtra);
    } else {
      sent = await ctx.api.sendDocument(chatId, new InputFile(buffer, filename || 'document.bin'), commonExtra);
    }
    return String(sent.message_id);
  }

  // ── Multi-attachment send ─────────────────────────────────────────────────
  // Buffers are already in memory — InputFile wraps them with zero extra I/O.

  // Batch multiple photos into one album — caption on first item only
  if (photos.length > 0) {
    await ctx.api.sendMediaGroup(
      chatId,
      photos.map(({ buffer, filename }, idx) => ({
        type: 'photo' as const,
        media: new InputFile(buffer, filename || `photo_${idx}.jpg`),
        // caption_entities and parse_mode on the first item apply to the album caption only;
        // subsequent items in the group intentionally omit them (Telegram Bot API limitation)
        ...(idx === 0 && text
          ? {
              caption: text,
              ...(entities.length ? { caption_entities: entities as MessageEntity[] } : {}),
              ...(parseMode !== undefined ? { parse_mode: parseMode } : {}),
            }
          : {}),
      })),
      captionExtra,
    );
  }

  for (const [i, { buffer, filename }] of videos.entries()) {
    await ctx.api.sendVideo(
      chatId,
      new InputFile(buffer, filename || 'video.mp4'),
      i === 0 && photos.length === 0 && text
        ? { caption: text, ...captionExtra }
        : captionExtra,
    );
  }

  for (const [i, { buffer, filename }] of gifs.entries()) {
    await ctx.api.sendAnimation(
      chatId,
      new InputFile(buffer, filename || 'animation.gif'),
      i === 0 && photos.length === 0 && videos.length === 0 && text
        ? { caption: text, ...captionExtra }
        : captionExtra,
    );
  }

  for (const { buffer, filename } of audios) {
    // Use sendAudio instead of sendVoice: Telegram's editMessageMedia cannot mutate Voice messages.
    await ctx.api.sendAudio(chatId, new InputFile(buffer, filename || 'audio.mp3'), captionExtra);
  }

  for (const { buffer, filename } of others) {
    await ctx.api.sendDocument(chatId, new InputFile(buffer, filename || 'document.bin'), { caption: text, ...captionExtra });
  }

  // sendMediaGroup does not support reply_markup — send a separate message with
  // the button keyboard appended after the media so both are visible in sequence.
  if (replyMarkup) {
    const sent = await ctx.api.sendMessage(chatId, text || '\u200b', {
      ...replyExtra,
      ...(parseMode !== undefined ? { parse_mode: parseMode } : {}),
      reply_markup: replyMarkup,
    });
    return String(sent.message_id);
  }

  return undefined;
}
