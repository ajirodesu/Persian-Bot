/**
 * React-On-Success Library — shared "success reaction" helper.
 *
 * Centralises the contract used by the command dispatcher and any onChat
 * handler that produces a reply: react to the triggering message with the
 * session's dynamically-configured emoji ONLY on success, and never let a
 * reaction failure surface as an error (best-effort UX touch).
 *
 * The session emoji is read through getSessionReactionEmoji (LRU-cached), so
 * the hot path makes zero DB reads once the session blob is warm.
 */

import type { BaseCtx } from '@/engine/types/controller.types.js';
import { getSessionReactionEmoji } from '@/engine/repos/reaction-emoji.repo.js';

/**
 * Reacts to the message described by `event` after a successfully handled
 * command/reply. No-ops when the message has no threadID/messageID or the
 * platform cannot react. Any error is swallowed.
 */
export async function reactOnSuccess(
  ctx: BaseCtx,
  event: Record<string, unknown>,
): Promise<void> {
  const threadID = (event['threadID'] as string | undefined) ?? '';
  const messageID = (event['messageID'] as string | undefined) ?? '';
  if (!threadID || !messageID) return;

  try {
    const reactionEmoji = await getSessionReactionEmoji(
      ctx.native.userId ?? '',
      ctx.native.platform,
      ctx.native.sessionId ?? '',
    );
    await ctx.api.reactToMessage(threadID, messageID, reactionEmoji);
  } catch (err: unknown) {
    ctx.logger.debug('[react-on-success] reactToMessage failed', {
      threadID,
      messageID,
      error: err,
    });
  }
}