/**
 * Telegram — restrictUser / unrestrictUser
 *
 * Uses the Bot API's restrictChatMember directly. Restricting sets every
 * permission flag false (can't send text, media, polls, or use inline
 * features) while leaving the member in the chat; unrestricting flips them
 * all back to true, matching the chat's default member permissions.
 *
 * `until_date` is Telegram's native expiry — a Unix timestamp (seconds)
 * after which the restriction is lifted automatically by Telegram itself.
 * Per Bot API docs, a duration under 30 seconds is treated as "forever" by
 * Telegram, so callers wanting a short restriction should round up.
 */
import type { Context } from 'grammy';

const RESTRICTED_PERMISSIONS = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false,
} as const;

const UNRESTRICTED_PERMISSIONS = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
  can_change_info: false,
  can_invite_users: true,
  can_pin_messages: false,
  can_manage_topics: false,
} as const;

export async function restrictUser(
  ctx: Context,
  threadID: string,
  userID: string,
  durationMs?: number,
): Promise<void> {
  const chatId = Number(threadID) || ctx.chat?.id;
  if (!chatId) throw new Error('Not in a chat.');

  await ctx.api.restrictChatMember(chatId, Number(userID), RESTRICTED_PERMISSIONS, {
    // Round up to at least 30s — Telegram treats shorter windows as permanent.
    ...(durationMs
      ? { until_date: Math.floor(Date.now() / 1000) + Math.max(30, Math.ceil(durationMs / 1000)) }
      : {}),
  });
}

export async function unrestrictUser(
  ctx: Context,
  threadID: string,
  userID: string,
): Promise<void> {
  const chatId = Number(threadID) || ctx.chat?.id;
  if (!chatId) throw new Error('Not in a chat.');

  await ctx.api.restrictChatMember(chatId, Number(userID), UNRESTRICTED_PERMISSIONS);
}
