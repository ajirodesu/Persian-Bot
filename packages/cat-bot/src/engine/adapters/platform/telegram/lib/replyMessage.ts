/**
 * Telegram — replyMessage
 *
 * Routes attachments to the correct Bot API method by .name extension:
 *   photos → sendMediaGroup (single album call, up to 10)
 *   gifs   → sendAnimation (sendMediaGroup cannot mix animation + photo types)
 *   audio  → sendVoice (sequential; no sendVoiceGroup in Bot API)
 *   others → sendDocument
 *
 * attachment_url[] entries are forwarded to the Bot API as plain URL strings —
 * Telegram's own servers fetch them, so the bot never downloads the bytes.
 * attachment[] entries (already-in-hand streams/buffers) are still buffered
 * locally into an InputFile, since there's no URL for Telegram to fetch.
 *
 * reply_to_message_id wires reply_parameters so Telegram threads the message
 * to the original. Caption appears on the first photo of a media group only —
 * Telegram displays one caption per group.
 */
import type { Context } from 'grammy';
import { InputFile } from 'grammy';
import type { MessageEntity } from 'grammy/types';
import type { ChatAction } from './sendTypingIndicator.js';
import { streamToBuffer } from '@/engine/utils/streams.util.js';
// text_mention entities allow tagging users by numeric ID without a public @username — Bot API 7.0+
import { buildTelegramMentionEntities } from '../utils/helper.util.js';
import { sanitizeMarkdownV2 } from '../utils/markdownv2.util.js';
import type { ReplyMessageOptions } from '@/engine/adapters/models/api.model.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { sendRichMessage } from './sendRichMessage.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// Normalize a filename or URL into its media extension. Query strings and
// fragments are stripped so "image.gif?size=100" routes as a GIF, not a file.
const extOf = (filenameOrUrl: string): string => {
  const clean = filenameOrUrl.split(/[?#]/)[0] ?? '';
  return clean.split('.').pop()?.toLowerCase() ?? '';
};

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp'];
const GIF_EXT = 'gif';
const AUDIO_EXTS = ['mp3', 'ogg', 'wav', 'aac', 'opus', 'm4a'];
const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
const MEDIA_EXTS = new Set([...IMAGE_EXTS, GIF_EXT, ...AUDIO_EXTS, ...VIDEO_EXTS]);

// GIF magic bytes ("GIF87a" / "GIF89a") — used to classify a stream attachment
// whose filename carries no media extension so it still sends as an animation.
const isGifBuffer = (buffer: Buffer): boolean =>
  buffer.length >= 6 &&
  buffer[0] === 0x47 &&
  buffer[1] === 0x49 &&
  buffer[2] === 0x46 &&
  buffer[3] === 0x38;

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

  // Flashes the native "sending X…" bubble matching the media about to be
  // uploaded (fire-and-forget — a failed action must never break the send).
  const flashAction = (action: ChatAction): void => {
    void ctx.api.sendChatAction(chatId, action).catch(() => {});
  };
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

  // ── Pre-buffer stream attachments only ──────────────────────────────────────
  // URL attachments are NOT downloaded here anymore. Telegram's Bot API accepts a
  // plain HTTP(S) URL string in place of an InputFile for sendPhoto/sendVideo/
  // sendAnimation/sendAudio/sendDocument and for each item in sendMediaGroup —
  // Telegram's own servers fetch it, so the bot process never touches the bytes.
  // Only attachment[] (already-in-hand streams/buffers) need local buffering.
  type MediaItem = {
    filename: string;
    input: InputFile | string;
    /** Present for stream attachments so GIF magic-byte sniffing can route. */
    buffer?: Buffer;
  };

  const streamItems: MediaItem[] = await Promise.all(
    attachment.map(async ({ name, stream }): Promise<MediaItem> => {
      const buffer = Buffer.isBuffer(stream)
        ? stream
        : await streamToBuffer(stream as import('stream').Readable);
      return { filename: name, input: new InputFile(buffer, name), buffer };
    }),
  );
  const urlItems: MediaItem[] = attachment_url.map(({ name, url }) => {
    // Route by the URL's own extension when the name lacks a known media
    // extension — a .gif URL delivered with a generic/empty name must still
    // send as an animation, never as a file.
    const nameExt = extOf(name ?? '');
    const routeName = MEDIA_EXTS.has(nameExt) ? name : url;
    return { filename: routeName, input: url };
  });

  // stream attachments first (preserves caller ordering), URL attachments after
  const allAttachments: MediaItem[] = [...streamItems, ...urlItems];

  if (allAttachments.length === 0) {
    const sent = await ctx.api.sendMessage(chatId, text || ' ', {
      ...textExtra,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    return String(sent.message_id);
  }

  // Media-type routing — filename extension first, then GIF magic-byte
  // sniffing for streams whose filename carries no media extension.
  const extOfItem = ({ filename, buffer }: MediaItem): string => {
    const ext = extOf(filename);
    if (ext) return ext;
    if (buffer && isGifBuffer(buffer)) return GIF_EXT;
    return '';
  };

  const photos = allAttachments.filter((a) => IMAGE_EXTS.includes(extOfItem(a)));
  const gifs    = allAttachments.filter((a) => extOfItem(a) === GIF_EXT);
  const audios  = allAttachments.filter((a) => AUDIO_EXTS.includes(extOfItem(a)));
  const videos  = allAttachments.filter((a) => VIDEO_EXTS.includes(extOfItem(a)));
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
    const { input } = allAttachments[0]!;
    flashAction(
      photos.length === 1
        ? 'upload_photo'
        : videos.length === 1
          ? 'upload_video'
          : gifs.length === 1
            ? 'upload_video'
          : audios.length === 1
            ? 'upload_voice'
            : 'upload_document',
    );
    const commonExtra = {
      ...(text ? { caption: text } : {}),
      ...captionExtra,
      reply_markup: replyMarkup,
    };
    // `input` is already an InputFile (buffer) or a URL string — grammY's send methods
    // accept either directly, no extra awaits or wrapping needed here.
    let sent;
    if (photos.length === 1) {
      sent = await ctx.api.sendPhoto(chatId, input, commonExtra);
    } else if (videos.length === 1) {
      sent = await ctx.api.sendVideo(chatId, input, commonExtra);
    } else if (gifs.length === 1) {
      sent = await ctx.api.sendAnimation(chatId, input, commonExtra);
    } else if (audios.length === 1) {
      // Use sendAudio instead of sendVoice: Telegram's editMessageMedia cannot mutate Voice messages.
      sent = await ctx.api.sendAudio(chatId, input, commonExtra);
    } else {
      sent = await ctx.api.sendDocument(chatId, input, commonExtra);
    }
    return String(sent.message_id);
  }

  // ── Multi-attachment send ─────────────────────────────────────────────────
  // `input` is already an InputFile or a URL string — zero extra I/O here either way.

  // Batch multiple photos into one album — caption on first item only
  if (photos.length > 0) {
    flashAction('upload_photo');
    await ctx.api.sendMediaGroup(
      chatId,
      photos.map(({ input }, idx) => ({
        type: 'photo' as const,
        media: input,
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

  for (const [i, { input }] of videos.entries()) {
    flashAction('upload_video');
    await ctx.api.sendVideo(
      chatId,
      input,
      i === 0 && photos.length === 0 && text
        ? { caption: text, ...captionExtra }
        : captionExtra,
    );
  }

  for (const [i, { input }] of gifs.entries()) {
    flashAction('upload_video');
    await ctx.api.sendAnimation(
      chatId,
      input,
      i === 0 && photos.length === 0 && videos.length === 0 && text
        ? { caption: text, ...captionExtra }
        : captionExtra,
    );
  }

  for (const { input } of audios) {
    // Use sendAudio instead of sendVoice: Telegram's editMessageMedia cannot mutate Voice messages.
    flashAction('upload_voice');
    await ctx.api.sendAudio(chatId, input, captionExtra);
  }

  for (const { input } of others) {
    flashAction('upload_document');
    await ctx.api.sendDocument(chatId, input, { caption: text, ...captionExtra });
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
