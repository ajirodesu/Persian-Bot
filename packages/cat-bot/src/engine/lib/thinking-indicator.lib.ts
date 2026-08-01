/**
 * Thinking Indicator Lib — Telegram-only "AI is thinking…" signal.
 *
 * Bot API 10.1 added Rich Messages with InputRichBlockThinking: a live animated
 * "Thinking…" placeholder via sendRichMessageDraft, distinct from the generic typing bubble.
 * Valid only in private chats (sendRichMessageDraft rejects groups/channels).
 *
 * withThinkingIndicator wraps withTypingIndicator (running unconditionally everywhere) and
 * additionally streams a RichBlockThinking draft on Telegram private chats. The two run
 * concurrently — the thinking draft never replaces the typing indicator.
 *
 * Safe to call from cross-platform code: on Discord/WebChat and Telegram groups it is
 * identical to withTypingIndicator.
 */
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { withTypingIndicator, registerTypingStopper } from './typing-indicator.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { getAgentStatus } from '@/engine/agent/lib/agent-status.lib.js';

// Below sendRichMessageDraft's ~30s expiry; short enough to catch agent.ts live status updates.
const THINKING_REFRESH_INTERVAL_MS = 3000;

/** Fallback phrases used before the agent reports any specific action. */
const FALLBACK_THINKING_PHRASES = [
  '🧠 Thinking…',
  '💭 Working it out…',
  '⚙️ Putting it together…',
];

export interface ThinkingIndicatorOptions {
  /** Explicitly skip the rich draft for groups. Auto-detected from ctx.event when omitted. */
  isGroup?: boolean;
}

/**
 * Runs `fn` while keeping a typing indicator alive and — on Telegram private chats only —
 * additionally streaming an animated RichBlockThinking draft.
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

  if (!isTelegram || !threadID || isGroup) {
    return withTypingIndicator(api, threadID, fn);
  }

  const draftId = Math.floor(Math.random() * 2_000_000_000) + 1;
  let phraseIndex = 0;
  let inFlight = false;

  const trigger = (): void => {
    if (inFlight) return;
    inFlight = true;
    // Prefer agent's live status; fall back to generic rotation on the first tick.
    const liveText = getAgentStatus(ctx);
    let text: string;
    if (liveText) {
      text = liveText;
    } else {
      text = FALLBACK_THINKING_PHRASES[phraseIndex % FALLBACK_THINKING_PHRASES.length]!;
      phraseIndex += 1;
    }
    void api.sendThinkingDraft(threadID, text, draftId)
      .then(() => { inFlight = false; })
      .catch((err: unknown) => {
        inFlight = false;
        logger.debug('[thinking-indicator] sendThinkingDraft failed', { platform: api.platform, threadID, error: err });
      });
  };

  let draftStopped = false;
  const stopDraft = (): void => {
    if (draftStopped) return;
    draftStopped = true;
    clearInterval(interval);
  };
  // stopTypingIndicator(threadID) tears down both the draft refresh and the typing bubble together.
  const unregisterDraft = registerTypingStopper(threadID, stopDraft);

  trigger();
  const interval = setInterval(trigger, THINKING_REFRESH_INTERVAL_MS);

  try {
    return await withTypingIndicator(api, threadID, fn);
  } finally {
    stopDraft();
    unregisterDraft();
  }
}
