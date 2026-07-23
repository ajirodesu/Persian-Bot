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
 *
 * STABILITY: An in-flight guard prevents overlapping sendTypingIndicator
 * calls. Without it, a slow network leg can cause the interval to fire
 * again before the previous request has resolved, stacking up concurrent
 * HTTP calls that provide no benefit and add noise to the platform API.
 *
 * INSTANT STOP ON SEND:
 * Waiting for the whole command promise to settle before tearing the
 * indicator down isn't enough on its own — a command that sends its reply
 * midway through (then keeps doing unrelated background work, logging,
 * cache writes, etc.) would otherwise leave "typing…" visible long after the
 * user has already seen the bot's message, and a refresh tick that fires in
 * the gap between "message sent" and "promise settled" can even resurrect
 * the indicator right after it appeared to stop. To close that gap, every
 * active indicator registers a stop callback here, keyed by threadID.
 * ctx.chat.reply()/replyMessage() (see context.model.ts) call
 * stopTypingIndicator(threadID) the instant a message is actually delivered,
 * which tears the interval down immediately — independent of whether the
 * wrapped command/agent function has finished running.
 */
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// Below the shortest native expiry window (Telegram, ~5s) so the indicator
// never visibly drops out while processing is still ongoing.
const TYPING_REFRESH_INTERVAL_MS = 4000;

// ── Active-indicator registry ───────────────────────────────────────────────
// Keyed by threadID. Lets any code that knows "a message just got sent to
// this thread" (namely ctx.chat.reply/replyMessage) tear down whichever
// indicator(s) are currently active on that thread, without needing a direct
// reference to the controller that started them.
const activeStoppers = new Map<string, Set<() => void>>();

/**
 * Registers `stop` under `threadID` in the shared active-indicator registry
 * so a future stopTypingIndicator(threadID) call also invokes it. Returns an
 * unregister function that removes just this entry (call it once `stop` has
 * already run via normal completion, so a later, unrelated indicator on the
 * same thread doesn't accidentally get torn down through a stale entry).
 *
 * Exported so other indicator implementations (e.g. thinking-indicator.lib.ts's
 * Telegram rich-draft refresh loop) can plug their own teardown into the same
 * "instant stop on send" mechanism as the base typing indicator.
 */
export function registerTypingStopper(
  threadID: string,
  stop: () => void,
): () => void {
  return registerStopper(threadID, stop);
}

function registerStopper(threadID: string, stop: () => void): () => void {
  if (!threadID) return () => {};
  let stoppers = activeStoppers.get(threadID);
  if (!stoppers) {
    stoppers = new Set();
    activeStoppers.set(threadID, stoppers);
  }
  stoppers.add(stop);
  return () => {
    const set = activeStoppers.get(threadID);
    if (!set) return;
    set.delete(stop);
    if (set.size === 0) activeStoppers.delete(threadID);
  };
}

/**
 * Immediately halts every typing/thinking indicator currently active on
 * `threadID` (clears their refresh intervals). Safe to call even if no
 * indicator is active — a no-op in that case. Called by
 * ctx.chat.reply()/replyMessage() the moment a message is actually sent, so
 * the indicator never visibly outlives the bot's real response.
 */
export function stopTypingIndicator(threadID: string): void {
  if (!threadID) return;
  const stoppers = activeStoppers.get(threadID);
  if (!stoppers || stoppers.size === 0) return;
  for (const stop of Array.from(stoppers)) stop();
  activeStoppers.delete(threadID);
}

/**
 * Runs `fn` while keeping a typing indicator alive on `threadID` for its
 * entire duration. Indicator failures are logged and swallowed — they must
 * never fail or delay the underlying command execution.
 *
 * The indicator can be torn down early in two ways, whichever happens
 * first: `fn` settling (normal completion/throw), or an external call to
 * stopTypingIndicator(threadID) — issued the instant the bot's actual reply
 * is sent — via the registry above.
 *
 * If `threadID` is empty the function runs `fn` without any indicator,
 * since there is no thread to address.
 */
export async function withTypingIndicator<T>(
  api: UnifiedApi,
  threadID: string,
  fn: () => Promise<T>,
): Promise<T> {
  // No thread → skip indicator entirely; nothing to address it to.
  if (!threadID) return fn();

  // In-flight guard: skip if a sendTypingIndicator call is already in
  // progress.  Prevents overlapping HTTP requests when the interval fires
  // faster than the previous request resolves (e.g. on a slow network).
  let inFlight = false;
  let stopped = false;
  let interval: ReturnType<typeof setInterval> | undefined;

  const trigger = (): void => {
    // Once stopped, never issue another signal — this is what guarantees the
    // indicator can't be resurrected by an in-flight interval tick racing
    // against a just-sent message.
    if (stopped || inFlight) return;
    inFlight = true;
    void api
      .sendTypingIndicator(threadID)
      .then(() => {
        inFlight = false;
      })
      .catch((err: unknown) => {
        inFlight = false;
        logger.debug('[typing-indicator] sendTypingIndicator failed', {
          platform: api.platform,
          threadID,
          error: err,
        });
      });
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (interval) clearInterval(interval);
  };

  const unregister = registerStopper(threadID, stop);

  // Fire immediately so the indicator appears the instant processing starts,
  // then keep refreshing it dynamically for as long as `fn` is still running
  // (or until stopTypingIndicator(threadID) cuts it short — see above).
  trigger();
  interval = setInterval(trigger, TYPING_REFRESH_INTERVAL_MS);

  try {
    return await fn();
  } finally {
    stop();
    unregister();
  }
}
