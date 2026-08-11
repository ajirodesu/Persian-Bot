/**
 * Telegram — sendTypingIndicator
 *
 * Uses the Bot API sendChatAction method with the action matching what the bot
 * is actually about to deliver, so Telegram shows the correct notice instead of
 * a generic "typing…" (e.g. "sending video…", "sending photo…", "sending file…").
 * Telegram clears the indicator after ~5 seconds, so the caller is responsible
 * for re-sending it on an interval for the duration of a long-running command —
 * this function only issues a single signal per call.
 */
import type { Context } from 'grammy';
import type { TypingAction } from '@/engine/adapters/models/api.model.js';

/** Telegram Bot API chat-action union (grammY doesn't expose a named ChatAction type). */
export type ChatAction =
  | 'typing'
  | 'upload_photo'
  | 'record_video'
  | 'upload_video'
  | 'record_voice'
  | 'upload_voice'
  | 'upload_document'
  | 'choose_sticker'
  | 'find_location'
  | 'record_video_note'
  | 'upload_video_note';

/** Maps our platform-agnostic action to the Telegram ChatAction enum. */
const ACTION_MAP: Record<TypingAction, ChatAction> = {
  typing: 'typing',
  photo: 'upload_photo',
  video: 'upload_video',
  audio: 'upload_voice',
  document: 'upload_document',
  record_audio: 'record_voice',
  find_location: 'find_location',
};

export async function sendTypingIndicator(
  ctx: Context,
  threadID: string,
  action: TypingAction = 'typing',
): Promise<void> {
  const chatId = Number(threadID) || ctx.chat?.id;
  if (!chatId) return;
  await ctx.api.sendChatAction(chatId, ACTION_MAP[action]);
}