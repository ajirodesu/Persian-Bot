/**
 * Thinking Indicator Lib — Telegram-only "AI is thinking…" signal, layered on
 * top of the cross-platform typing indicator.
 *
 * WHY THIS EXISTS SEPARATELY FROM typing-indicator.lib.ts:
 * Bot API 10.1 (June 11, 2026) added Rich Messages with an InputRichBlockThinking
 * block — a live, animated "Thinking…" placeholder rendered via
 * sendRichMessageDraft, distinct from the generic chat-action typing bubble.
 * It is Telegram-specific (no Discord/WebChat equivalent) and, per the Bot API,
 * only valid in PRIVATE chats (sendRichMessageDraft rejects groups/channels).
 *
 * This wrapper keeps the existing withTypingIndicator running everywhere
 * unconditionally (so Discord/WebChat/Telegram-groups keep their familiar
 * typing bubble), and additionally drives a RichBlockThinking draft on Telegram
 * private chats for a richer "the AI agent is thinking" preview. The two run
 * concurrently — thinking drafts never replace the typing indicator.
 *
 * The draft is purely a live preview: it auto-expires after ~30s if not
 * refreshed, is never persisted, and the caller's `fn` is still expected to
 * send the real, final reply via ctx.chat.replyMessage as usual once it
 * resolves — this wrapper does not send or edit the final message itself.
 */
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { withTypingIndicator } from './typing-indicator.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// Below sendRichMessageDraft's ~30s expiry so the placeholder never visibly
// drops out while `fn` is still running. Matches TYPING_REFRESH_INTERVAL_MS's
// margin-of-safety reasoning in typing-indicator.lib.ts.
const THINKING_REFRESH_INTERVAL_MS = 8000;

/** Rotates through a handful of phrases so a long-running generation doesn't look stuck. */
const THINKING_PHRASES = [
  '🧠 Thinking…',
  '💭 Working it out…',
  '⚙️ Putting it together…',
];

export interface ThinkingIndicatorOptions {
  /** Set true for group/supergroup chats to explicitly skip the rich draft (sendRichMessageDraft is private-chat-only). Auto-detected when omitted. */
  isGroup?: boolean;
}

/**
 * Runs `fn` while keeping a typing indicator alive on `threadID`, and — on
 * Telegram private chats only — additionally streaming an animated
 * RichBlockThinking draft for the duration.
 *
 * Safe to call unconditionally from cross-platform code (agent.ts):
 * on Discord/WebChat, and on Telegram groups, this behaves identically to
 * withTypingIndicator — the thinking-draft branch is simply skipped.
 */
export async function withThinkingIndicator<T>(
  ctx: AppCtx,
  threadID: string,
  fn: () => Promise<T>,
  options: ThinkingIndicatorOptions = {},
): Promise<T> {
  const api: UnifiedApi = ctx.api;
  const isTelegram = ctx.native.platform === Platforms.Telegram;
  const isGroup = options.isGroup ?? Boolean(ctx.event['isGroup']);

  // Non-Telegram, no thread, or a group chat → plain typing indicator only.
  if (!isTelegram || !threadID || isGroup) {
    return withTypingIndicator(api, threadID, fn);
  }

  const draftId = Math.floor(Math.random() * 2_000_000_000) + 1;
  let phraseIndex = 0;
  let inFlight = false;

  const trigger = (): void => {
    if (inFlight) return;
    inFlight = true;
    const text = THINKING_PHRASES[phraseIndex % THINKING_PHRASES.length]!;
    phraseIndex += 1;
    void api
      .sendThinkingDraft(threadID, text, draftId)
      .then(() => {
        inFlight = false;
      })
      .catch((err: unknown) => {
        inFlight = false;
        logger.debug('[thinking-indicator] sendThinkingDraft failed', {
          platform: api.platform,
          threadID,
          error: err,
        });
      });
  };

  trigger();
  const interval = setInterval(trigger, THINKING_REFRESH_INTERVAL_MS);

  try {
    // Run the typing indicator concurrently for the same duration — see
    // module docstring for why both stay active together.
    return await withTypingIndicator(api, threadID, fn);
  } finally {
    clearInterval(interval);
  }
}
