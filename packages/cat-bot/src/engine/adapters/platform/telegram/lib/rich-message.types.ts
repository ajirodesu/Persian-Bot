/**
 * Telegram — Rich Message Type Definitions
 *
 * Bot API 10.1 (June 11, 2026) introduced Rich Messages (InputRichMessage,
 * sendRichMessage, sendRichMessageDraft, RichBlockThinking, etc.) and Bot API
 * 10.2 (July 14, 2026) extended InputRichMessage with a `blocks` field for
 * structured (non-markdown/html) construction, plus the InputRichBlock*
 * family — including InputRichBlockThinking — and InputRichMessageMedia.
 *
 * grammY ^1.44 predates both releases, so none of this surface exists in
 * grammY's bundled `grammy/types`. These interfaces are hand-authored from
 * the official changelog (https://core.telegram.org/bots/api#july-14-2026,
 * https://core.telegram.org/bots/api#june-11-2026) and are consumed via the
 * raw-API escape hatch in `raw-api.util.ts` rather than `ctx.api.<method>`.
 *
 * Only the surface Cat-Bot actually uses is modelled in full; anything else
 * (tables, maps, collages, etc.) is covered loosely via `InputRichBlock`
 * so callers aren't blocked from reaching for it, without hand-typing every
 * one of the 21 block variants up front.
 */

/** Discriminant shared by every structured block accepted in InputRichMessage.blocks. */
export type InputRichBlockType =
  | 'paragraph'
  | 'section_heading'
  | 'preformatted'
  | 'footer'
  | 'divider'
  | 'mathematical_expression'
  | 'anchor'
  | 'list'
  | 'block_quotation'
  | 'pull_quotation'
  | 'collage'
  | 'slideshow'
  | 'table'
  | 'details'
  | 'map'
  | 'animation'
  | 'audio'
  | 'photo'
  | 'video'
  | 'voice_note'
  | 'thinking';

/**
 * "Thinking…" placeholder block — mirrors the receive-side RichBlockThinking.
 * Corresponds to the custom HTML tag `<tg-thinking>`.
 *
 * CRITICAL (per Bot API docs): usable ONLY inside sendRichMessageDraft.
 * It cannot be persisted — sendRichMessage / editMessageText will reject it
 * (or simply never round-trip it back in Message.rich_message).
 */
export interface InputRichBlockThinking {
  type: 'thinking';
  /** Plain text (or lightly formatted RichText string) shown inside the placeholder. */
  text: string;
}

/**
 * Loose fallback shape for the remaining 20 InputRichBlock* variants
 * (paragraph, table, list, map, collage, etc.). Cat-Bot does not currently
 * construct these programmatically — rich content is normally authored via
 * InputRichMessage.markdown / .html — but the shape is left open so a
 * caller can drop down to raw blocks without fighting the type system.
 */
export interface InputRichBlockGeneric {
  type: Exclude<InputRichBlockType, 'thinking'>;
  [key: string]: unknown;
}

export type InputRichBlock = InputRichBlockThinking | InputRichBlockGeneric;

/**
 * Bot API 10.2 — explicit media reference for markdown/html rich messages
 * (InputRichMessageMedia). Lets a bot specify media out-of-band instead of
 * inlining a bare URL in the markdown/html body.
 */
export interface InputRichMessageMedia {
  type: 'photo' | 'video' | 'audio' | 'voice_note' | 'animation';
  media: string; // HTTP(S) URL or file_id, per InputFile-string conventions
}

/**
 * Describes a rich message to send. Exactly one of `html` / `markdown` /
 * `blocks` should be provided:
 *   - `markdown` — Rich Markdown (GFM-compatible + Telegram extensions:
 *     tables, tasklists, footnotes, `<tg-collage>`, `<tg-map>`, LaTeX, etc.)
 *   - `html`     — Rich HTML (`<b>`, `<tg-spoiler>`, `<tg-map>`, `<table>`, …)
 *   - `blocks`   — Bot API 10.2 structured block construction (required for
 *                  InputRichBlockThinking, since `<tg-thinking>` has no
 *                  markdown/html-only equivalent outside sendRichMessageDraft).
 */
export interface InputRichMessage {
  html?: string;
  markdown?: string;
  blocks?: InputRichBlock[];
  /** True if the rich message must be shown right-to-left. */
  is_rtl?: boolean;
  /**
   * Skip automatic detection of URLs, emails, @mentions, #hashtags,
   * $cashtags, /bot_commands, phone numbers, and bank card numbers.
   */
  skip_entity_detection?: boolean;
  /** Bot API 10.2 — explicit media referenced by markdown/html content. */
  media?: InputRichMessageMedia[];
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: Array<
    Array<{ text: string; callback_data?: string; url?: string }>
  >;
}

export interface TelegramReplyParameters {
  message_id?: number;
  chat_id?: number | string;
  ephemeral_message_id?: number;
  allow_sending_without_reply?: boolean;
}

/** Payload for the raw `sendRichMessage` Bot API method. */
export interface SendRichMessagePayload {
  business_connection_id?: string;
  chat_id: number | string;
  message_thread_id?: number;
  direct_messages_topic_id?: number;
  rich_message: InputRichMessage;
  disable_notification?: boolean;
  protect_content?: boolean;
  allow_paid_broadcast?: boolean;
  message_effect_id?: string;
  reply_parameters?: TelegramReplyParameters;
  reply_markup?: TelegramInlineKeyboardMarkup;
}

/** Raw Bot API response envelope for sendRichMessage (mirrors sendMessage → Message). */
export interface SendRichMessageResult {
  message_id: number;
  [key: string]: unknown;
}

/**
 * Payload for the raw `sendRichMessageDraft` Bot API method.
 * Private chats only (chat_id must be the numeric chat, never @username).
 * Ephemeral: each draft is a 30-second preview; the caller MUST follow up
 * with a real `sendRichMessage` call to persist the finished output.
 * Successive calls sharing the same non-zero draft_id are animated by the
 * client — this is how a live "Thinking…" placeholder is kept alive.
 */
export interface SendRichMessageDraftPayload {
  chat_id: number;
  message_thread_id?: number;
  draft_id: number;
  rich_message: InputRichMessage;
}

/** Payload for editMessageText when editing with rich_message instead of text. */
export interface EditRichMessageTextPayload {
  business_connection_id?: string;
  chat_id?: number | string;
  message_id?: number;
  inline_message_id?: string;
  rich_message: InputRichMessage;
  reply_markup?: TelegramInlineKeyboardMarkup;
}
