/**
 * Typing Indicator Lib — dynamic "bot is typing" signal for the lifetime of a command.
 *
 * Native indicators (Discord ~10s, Telegram ~5s) auto-expire and must be re-issued.
 * withTypingIndicator fires immediately, refreshes on an interval, and tears down the
 * moment the wrapped promise settles — so the indicator tracks real processing time.
 *
 * In-flight guard prevents overlapping sendTypingIndicator calls from stacking up.
 *
 * Instant stop on send: ctx.chat.reply/replyMessage call stopTypingIndicator(threadID)
 * the moment a message is delivered, tearing down the interval before a next refresh tick
 * could resurrect it after the user has already seen the reply.
 */
import type { UnifiedApi, TypingAction } from '@/engine/adapters/models/api.model.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// Below Telegram's ~5s expiry so the indicator never visibly drops during processing.
const TYPING_REFRESH_INTERVAL_MS = 4000;

// Keyed by threadID. Lets ctx.chat.reply/replyMessage tear down any active indicator
// without needing a direct reference to the controller that started it.
const activeStoppers = new Map<string, Set<() => void>>();

function registerStopper(threadID: string, stop: () => void): () => void {
  if (!threadID) return () => {};
  let stoppers = activeStoppers.get(threadID);
  if (!stoppers) { stoppers = new Set(); activeStoppers.set(threadID, stoppers); }
  stoppers.add(stop);
  return () => {
    const set = activeStoppers.get(threadID);
    if (!set) return;
    set.delete(stop);
    if (set.size === 0) activeStoppers.delete(threadID);
  };
}

/**
 * Registers a stop callback under threadID so stopTypingIndicator() can tear it down.
 * Exported for thinking-indicator.lib.ts to plug its own draft refresh into the same mechanism.
 */
export function registerTypingStopper(threadID: string, stop: () => void): () => void {
  return registerStopper(threadID, stop);
}

/** Immediately halts every typing/thinking indicator active on threadID. No-op if none. */
export function stopTypingIndicator(threadID: string): void {
  if (!threadID) return;
  const stoppers = activeStoppers.get(threadID);
  if (!stoppers || stoppers.size === 0) return;
  for (const stop of stoppers) stop();
  activeStoppers.delete(threadID);
}

/**
 * Runs `fn` while keeping a typing indicator alive on `threadID` for its entire duration.
 * Indicator failures are logged and swallowed — they must never delay command execution.
 * Torn down early either by `fn` settling, or by stopTypingIndicator(threadID) on message send.
 */
export async function withTypingIndicator<T>(
  api: UnifiedApi,
  threadID: string,
  fn: () => Promise<T>,
  action: TypingAction = 'typing',
): Promise<T> {
  if (!threadID) return fn();

  let inFlight = false;
  let stopped = false;

  const trigger = (): void => {
    if (stopped || inFlight) return;
    inFlight = true;
    void api.sendTypingIndicator(threadID, action)
      .then(() => { inFlight = false; })
      .catch((err: unknown) => {
        inFlight = false;
        logger.debug('[typing-indicator] sendTypingIndicator failed', { platform: api.platform, threadID, action, error: err });
      });
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
  };

  const unregister = registerStopper(threadID, stop);
  trigger();
  const interval: ReturnType<typeof setInterval> = setInterval(trigger, TYPING_REFRESH_INTERVAL_MS);

  try {
    return await fn();
  } finally {
    stop();
    unregister();
  }
}
