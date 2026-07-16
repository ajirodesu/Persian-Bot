/**
 * Typing Indicator Lib — dynamic "bot is typing" signal for the entire
 * lifetime of a command's processing.
 *
 * WHY DYNAMIC, NOT HARDCODED:
 * Native typing indicators (Discord ~10s, Telegram ~5s) auto-expire and must
 * be re-issued by the caller to stay visible. A single fire-and-forget call
 * before running a command would silently disappear on any command that
 * takes longer than that window. Instead, this wraps the command's actual
 * execution promise: the indicator fires immediately, is refreshed on an
 * interval for as long as the promise is still pending, and is torn down
 * the instant it settles — so its lifetime always tracks real processing
 * time rather than a fixed, guessed duration.
 */
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// Below the shortest native expiry window (Telegram, ~5s) so the indicator
// never visibly drops out while processing is still ongoing.
const TYPING_REFRESH_INTERVAL_MS = 4000;

/**
 * Runs `fn` while keeping a typing indicator alive on `threadID` for its
 * entire duration. Indicator failures are logged and swallowed — they must
 * never fail or delay the underlying command execution.
 */
export async function withTypingIndicator<T>(
  api: UnifiedApi,
  threadID: string,
  fn: () => Promise<T>,
): Promise<T> {
  const trigger = (): void => {
    void api.sendTypingIndicator(threadID).catch((err: unknown) => {
      logger.debug('[typing-indicator] sendTypingIndicator failed', {
        platform: api.platform,
        threadID,
        error: err,
      });
    });
  };

  // Fire immediately so the indicator appears the instant processing starts,
  // then keep refreshing it dynamically for as long as `fn` is still running.
  trigger();
  const interval = setInterval(trigger, TYPING_REFRESH_INTERVAL_MS);

  try {
    return await fn();
  } finally {
    clearInterval(interval);
  }
}
