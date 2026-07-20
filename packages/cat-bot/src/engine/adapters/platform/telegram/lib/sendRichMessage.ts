/**
 * Telegram — sendRichMessage
 *
 * Sends a fully-formatted InputRichMessage (Bot API 10.1+) instead of a
 * plain-text sendMessage. Mirrors replyMessage.ts's reply/button handling so
 * rich messages participate in the same reply-threading and inline-keyboard
 * conventions as every other Telegram send path.
 *
 * Text-mode (markdown/html) is the default construction path — it covers
 * everything Cat-Bot's rich-formatted replies need (headings, tables, code
 * blocks, spoilers, LaTeX, embedded media, etc.) without hand-building block
 * trees. `blocks` is exposed for callers that need structured construction
 * (e.g. RichBlockThinking via sendRichMessageDraft, see sendRichMessageDraft.ts).
 */
import type { Context } from 'grammy';
import { callRawTelegramApi } from '../utils/raw-api.util.js';
import type {
  InputRichMessage,
  SendRichMessagePayload,
  SendRichMessageResult,
  TelegramInlineKeyboardMarkup,
} from './rich-message.types.js';
import type { ButtonItem } from '@/engine/adapters/models/api.model.js';

export interface SendRichMessageOptions {
  /** Rich Markdown body — mutually exclusive with html/blocks. */
  markdown?: string;
  /** Rich HTML body — mutually exclusive with markdown/blocks. */
  html?: string;
  /** Bot API 10.2 structured block construction — mutually exclusive with markdown/html. */
  blocks?: InputRichMessage['blocks'];
  isRtl?: boolean;
  skipEntityDetection?: boolean;
  media?: InputRichMessage['media'];
  reply_to_message_id?: string;
  button?: ButtonItem[][];
  message_thread_id?: number;
}

function buildReplyMarkup(
  button: ButtonItem[][] = [],
): TelegramInlineKeyboardMarkup | undefined {
  if (button.length === 0) return undefined;
  return {
    inline_keyboard: button.map((row) =>
      row.map((btn) => ({
        text: btn.label,
        callback_data: btn.id.slice(0, 64),
      })),
    ),
  };
}

export async function sendRichMessage(
  ctx: Context,
  threadID: string,
  options: SendRichMessageOptions,
): Promise<string | undefined> {
  const {
    markdown,
    html,
    blocks,
    isRtl,
    skipEntityDetection,
    media,
    reply_to_message_id,
    button = [],
    message_thread_id,
  } = options;

  if (!markdown && !html && (!blocks || blocks.length === 0)) {
    throw new Error(
      '[telegram] sendRichMessage requires one of markdown, html, or blocks.',
    );
  }

  const chatId = Number(threadID) || (ctx.chat?.id as number);

  const rich_message: InputRichMessage = {
    ...(markdown !== undefined ? { markdown } : {}),
    ...(html !== undefined ? { html } : {}),
    ...(blocks !== undefined ? { blocks } : {}),
    ...(isRtl !== undefined ? { is_rtl: isRtl } : {}),
    ...(skipEntityDetection !== undefined
      ? { skip_entity_detection: skipEntityDetection }
      : {}),
    ...(media !== undefined ? { media } : {}),
  };

  const replyMarkup = buildReplyMarkup(button);

  const payload: SendRichMessagePayload = {
    chat_id: chatId,
    rich_message,
    ...(message_thread_id !== undefined ? { message_thread_id } : {}),
    ...(reply_to_message_id
      ? { reply_parameters: { message_id: Number(reply_to_message_id) } }
      : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  };

  const sent = await callRawTelegramApi<
    SendRichMessagePayload,
    SendRichMessageResult
  >(ctx, 'sendRichMessage', payload);

  return String(sent.message_id);
}
