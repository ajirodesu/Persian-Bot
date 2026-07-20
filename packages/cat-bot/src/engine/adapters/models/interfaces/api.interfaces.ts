/**
 * Cat-Bot — API Interfaces
 *
 * Core type definitions for the UnifiedApi contract.
 * Extracted from api.model.ts for single-responsibility.
 *
 * These interfaces define the data shapes that flow through the API layer:
 *   - MentionEntry: @mentions in message bodies
 *   - NamedStreamAttachment: File attachments with readable streams
 *   - NamedUrlAttachment: URL-based attachments to be downloaded
 *   - UserInfo: Minimal user display information
 *   - ButtonItem: Interactive button definitions
 */

import type { Readable } from 'stream';

// Re-export PlatformId from thread.model so consumers can import from either file.
// Defined in thread.model (leaf) to avoid circular dependency: api ← thread ← api.
export type { PlatformId } from '../thread.model.js';

import type { ButtonStyleValue } from '@/engine/constants/button-style.constants.js';

import type { MessageStyleValue } from '@/engine/constants/message-style.constants.js';

/**
 * A mention placeholder embedded in a message body.
 * Each platform adapter translates the tag+user_id pair to its native mention format.
 */
export interface MentionEntry {
  /** The placeholder text in the message body, e.g. '@Sender'. */
  tag: string;
  /** Platform user ID of the person being mentioned. */
  user_id: string;
}

/**
 * Named attachment stream — used in attachment[] arrays.
 * `name` sets the download filename; stream carries the binary content.
 */
export interface NamedStreamAttachment {
  name: string;
  stream: Readable | Buffer;
}

/**
 * Named URL attachment — downloaded by the platform wrapper before sending.
 * `name` sets the download filename so MIME detection derives from the extension.
 */
export interface NamedUrlAttachment {
  name: string;
  url: string;
}

/**
 * Minimal user display info returned by getUserInfo().
 * Use getFullUserInfo() for the richer UnifiedUserInfo shape.
 */
export interface UserInfo {
  name: string;
}

/**
 * Resolved button definition passed to platform replyMessage implementations.
 * Produced by createChatContext.resolveButtons() from the command's menu export —
 * callers never construct this directly; they pass bare button ID strings to chat.reply().
 */
export interface ButtonItem {
  /** Fully-qualified callback ID: "commandName:buttonId". */
  id: string;
  /** Display label shown on the button face. */
  label: string;
  /**
   * Visual style hint from ButtonStyle.
   * Only meaningful on Discord; other platforms ignore it.
   */
  style?: ButtonStyleValue;
}

/**
 * Telegram-only options that accompany style: RICH_MARKDOWN / RICH_HTML.
 * Ignored on every other platform (Discord/FB fall back to native markdown
 * rendering of `message` — see message-style.constants.ts for the rationale).
 */
export interface RichMessageOptions {
  /** True if the rich message must be shown right-to-left. */
  isRtl?: boolean;
  /**
   * Skip automatic detection of URLs, emails, @mentions, #hashtags,
   * $cashtags, /bot_commands, and phone/bank-card numbers in `message`.
   */
  skipEntityDetection?: boolean;
  /**
   * Bot API 10.2 structured block construction (InputRichMessage.blocks).
   * When provided, `message` is ignored and this takes over as the sole
   * content source — used for content that must be built programmatically
   * (e.g. RichBlockThinking) rather than authored as markdown/html text.
   * Loosely typed here (kept generic) so this shared interface file doesn't
   * need to import the full Telegram rich-message type surface; see
   * adapters/platform/telegram/lib/rich-message.types.ts for the real shape.
   */
  blocks?: Array<Record<string, unknown>>;
  /** Bot API 10.2 — explicit media referenced by markdown/html content. */
  media?: Array<{
    type: 'photo' | 'video' | 'audio' | 'voice_note' | 'animation';
    media: string;
  }>;
}

/**
 * Payload accepted by sendMessage() and replyMessage().
 * Platforms that do not support a given field silently ignore it.
 */
export interface SendPayload {
  /** Text content (legacy key). */
  body?: string;
  /** Text content (unified key; preferred over body). */
  message?: string;
  /** Mention entries; each platform adapter translates to its native format. */
  mentions?: MentionEntry[];
  /**
   * Single stream OR named-stream array (unified).
   * Platform wrappers normalise whichever form they receive.
   */
  attachment?: Readable | NamedStreamAttachment[];
  /** Named URL array; downloaded before send by the platform wrapper. */
  attachment_url?: NamedUrlAttachment[];
  /** Telegram-only: options for style RICH_MARKDOWN / RICH_HTML. */
  rich?: RichMessageOptions;
}

/**
 * Options accepted by editMessage().
 * Aligns closely with ReplyMessageOptions, scoped for editing payloads.
 */
export interface EditMessageOptions {
  message?: string | SendPayload;
  message_id_to_edit?: string;
  style?: MessageStyleValue;
  /**
   * Each inner array is one keyboard row — maps directly to Telegram InlineKeyboardButton[][].
   * Flat arrays are normalised to a single row by createChatContext.resolveButtons().
   */
  button?: ButtonItem[][];
  /** Stream-based file attachments added to the edited message — uploaded by the platform wrapper (mirroring replyMessage attachment handling). */
  attachment?: NamedStreamAttachment[];
  /** URL-based file attachments — downloaded by the platform wrapper before upload; used to replace or augment message media. */
  attachment_url?: NamedUrlAttachment[];
  /** Thread ID implicitly injected by chat.editMessage for fallback use by platforms that do not support native editing. */
  threadID?: string;
  /** Telegram-only: options for style RICH_MARKDOWN / RICH_HTML — edits via rich_message instead of text. */
  rich?: RichMessageOptions;
}

/**
 * Options accepted by replyMessage().
 */
export interface ReplyMessageOptions {
  message?: string | SendPayload;
  attachment?: NamedStreamAttachment[];
  attachment_url?: NamedUrlAttachment[];
  /** ID of the message to thread this reply under. */
  reply_to_message_id?: string;
  /**
   * Resolved button rows built by createChatContext.resolveButtons().
   * Each inner array is one keyboard row — maps directly to Telegram InlineKeyboardButton[][].
   */
  button?: ButtonItem[][];
  mentions?: MentionEntry[];
  /**
   * Controls how the message text is rendered.
   * 'text'          → raw plain text; markdown syntax is escaped / not applied.
   * 'markdown'      → formatted text; each platform uses its native mechanism.
   * 'rich_markdown' → Telegram-only: InputRichMessage.markdown via sendRichMessage.
   * 'rich_html'     → Telegram-only: InputRichMessage.html via sendRichMessage.
   * Omitting this field preserves the historic default for that platform.
   */
  style?: MessageStyleValue;
  /** Telegram-only: options for style RICH_MARKDOWN / RICH_HTML. */
  rich?: RichMessageOptions;
}
