/**
 * Telegram — editMessage
 *
 * editMessageText(chatId, messageId, text, other) and editMessageMedia(chatId,
 * messageId, media, other): grammY pulls chat_id/message_id into the positional
 * signature and omits inline_message_id entirely when chat_id/message_id are
 * supplied — no explicit `undefined` placeholder is needed for the inline-message case.
 */
import type { Context } from 'grammy';
import { InputFile } from 'grammy';
import type { InputMedia } from 'grammy/types';
import type { EditMessageOptions } from '@/engine/adapters/models/api.model.js';
import { sanitizeMarkdownV2 } from '../utils/markdownv2.util.js';
import { streamToBuffer, urlToStream } from '@/engine/utils/streams.util.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { callRawTelegramApi } from '../utils/raw-api.util.js';
import type {
  EditRichMessageTextPayload,
  InputRichBlock,
  InputRichMessage,
} from './rich-message.types.js';

/** Maps a file extension to a Telegram InputMedia `type` discriminant — used when replacing message media via editMessageMedia. */
function getMediaType(ext: string): InputMedia['type'] {
  if (['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext)) return 'photo';
  if (ext === 'gif') return 'animation';
  if (['mp3', 'ogg', 'wav', 'aac', 'opus', 'm4a'].includes(ext)) return 'audio';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
  return 'document';
}

export async function editMessage(
  ctx: Context,
  messageID: string,
  options: string | EditMessageOptions,
): Promise<void> {
  // Safely extract text from both plain string and unified SendPayload shapes —
  // options.message is typed as string | SendPayload | undefined; the nested object
  // branch handles the case where a raw SendPayload is forwarded from context.model.
  let text: string;
  if (typeof options === 'string') {
    text = options;
  } else {
    const rawMsg = options.message;
    text =
      typeof rawMsg === 'string'
        ? rawMsg
        : ((rawMsg as { message?: string } | undefined)?.message ??
          (rawMsg as { body?: string } | undefined)?.body ??
          '');
  }

  const style = typeof options === 'object' ? options.style : undefined;
  const parseMode = style === MessageStyle.MARKDOWN ? 'MarkdownV2' : undefined;

  if (parseMode === 'MarkdownV2') text = sanitizeMarkdownV2(text);

  const button = typeof options === 'object' ? options.button : undefined;
  let replyMarkup;

  if (button !== undefined) {
    replyMarkup =
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
        : { inline_keyboard: [] };
  }

  // ── Rich Message edit dispatch (Bot API 10.1+ InputRichMessage) ────────────
  // editMessageText accepts either `text` or `rich_message` — never both — so
  // rich styles are routed here before the legacy attachment/MarkdownV2 paths.
  // Note: InputRichBlockThinking cannot be persisted this way (or at all outside
  // sendRichMessageDraft), so thinking placeholders never flow through editMessage.
  if (style === MessageStyle.RICH_MARKDOWN || style === MessageStyle.RICH_HTML) {
    const mId = parseInt(messageID, 10);
    if (!Number.isFinite(mId) || mId <= 0) {
      throw new Error(`[telegram] editMessage: invalid messageID "${messageID}"`);
    }
    const richOpts = typeof options === 'object' ? options.rich : undefined;
    const rich_message: InputRichMessage = {
      ...(style === MessageStyle.RICH_MARKDOWN ? { markdown: text } : { html: text }),
      ...(richOpts?.blocks
        ? { blocks: richOpts.blocks as unknown as InputRichBlock[] }
        : {}),
      ...(richOpts?.isRtl !== undefined ? { is_rtl: richOpts.isRtl } : {}),
      ...(richOpts?.skipEntityDetection !== undefined
        ? { skip_entity_detection: richOpts.skipEntityDetection }
        : {}),
      ...(richOpts?.media ? { media: richOpts.media } : {}),
    };
    const payload: EditRichMessageTextPayload = {
      chat_id: ctx.chat?.id as number,
      message_id: mId,
      rich_message,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    };
    await callRawTelegramApi<EditRichMessageTextPayload, unknown>(
      ctx,
      'editMessageText',
      payload,
    );
    return;
  }

  // Telegram's Bot API separates text editing from media editing:
  //   editMessageText  — modifies text only; cannot add or change attachments.
  //   editMessageMedia — replaces the entire message media; text goes as caption (max 1024 chars).
  // When attachments are provided, editMessageMedia is used with the FIRST attachment
  // (Telegram's single-media-per-message constraint). For URL-based attachments, the URL is
  // passed directly as `media` — Telegram downloads it server-side without a round-trip.
  // Caution: if the original message is text-only, the Bot API may return a 400 error;
  // this is surfaced to the caller rather than silently swallowed so the developer can adapt.
  const attachment =
    typeof options === 'object' ? options.attachment : undefined;
  const attachmentUrl =
    typeof options === 'object' ? options.attachment_url : undefined;
  if (attachment?.length || attachmentUrl?.length) {
    const mId = parseInt(messageID, 10);
    if (!Number.isFinite(mId) || mId <= 0)
      throw new Error(
        `[telegram] editMessage: invalid messageID "${messageID}"`,
      );
    // noUncheckedIndexedAccess: [0] returns T | undefined — explicit first/firstUrl guards below
    const first = attachment?.[0];
    const firstUrl = !first ? attachmentUrl?.[0] : undefined;
    let inputMedia: InputMedia | undefined;
    if (first) {
      // Buffer the incoming stream so InputFile can wrap it for multipart upload
      const buf = Buffer.isBuffer(first.stream)
        ? first.stream
        : await streamToBuffer(first.stream as import('stream').Readable);
      const ext = first.name.split('.').pop()?.toLowerCase() ?? '';
      inputMedia = {
        type: getMediaType(ext),
        media: new InputFile(buf, first.name || 'file.bin'),
        ...(text ? { caption: text } : {}),
        ...(parseMode ? { parse_mode: parseMode } : {}),
      } as InputMedia;
    } else if (firstUrl) {
      // URL media: Download locally first to match replyMessage.ts behavior.
      // Telegram server-side URL fetching sometimes converts mp4s to animations (GIFs)
      // or misidentifies media types. Multipart upload with explicit filename prevents this.
      const stream = await urlToStream(firstUrl.url, firstUrl.name);
      const buf = await streamToBuffer(stream as import('stream').Readable);
      const urlExt = firstUrl.name.split('.').pop()?.toLowerCase() ?? '';
      inputMedia = {
        type: getMediaType(urlExt),
        media: new InputFile(buf, firstUrl.name || 'file.bin'),
        ...(text ? { caption: text } : {}),
        ...(parseMode ? { parse_mode: parseMode } : {}),
      } as InputMedia;
    }
    if (inputMedia) {
      await ctx.api.editMessageMedia(
        ctx.chat?.id as number,
        mId,
        inputMedia,
        replyMarkup ? { reply_markup: replyMarkup } : undefined,
      );
      return;
    }
  }

  // parseInt with base-10 radix guards against the silent failures Number() produces:
  // Number('') === 0 and Number('undefined') === NaN both cause Telegram Bot API 400.
  const msgId = parseInt(messageID, 10);
  if (!Number.isFinite(msgId) || msgId <= 0) {
    throw new Error(`[telegram] editMessage: invalid messageID "${messageID}"`);
  }
  await ctx.api.editMessageText(ctx.chat?.id as number, msgId, text, {
    ...(parseMode ? { parse_mode: parseMode } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}
