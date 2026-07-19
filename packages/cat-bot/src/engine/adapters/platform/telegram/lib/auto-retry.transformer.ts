/**
 * Telegram — Auto-Retry Transformer
 *
 * Rapidly clicking a "Refresh"-style button (ping's Refresh, meme's Next Meme,
 * etc.) fires repeated editMessageText/editMessageMedia/sendMessage calls to
 * the same chat in a short window. Telegram's Bot API enforces flood control
 * on this — once tripped, every call returns:
 *
 *   { ok: false, error_code: 429, description: 'Too Many Requests: retry after N',
 *     parameters: { retry_after: N } }
 *
 * Previously this 429 propagated as a thrown GrammyError all the way up to
 * handleButtonAction's catch, which only logged it — the refresh silently did
 * nothing and the user saw no update. Discord's button-refresh flow doesn't
 * hit an equivalent hard wall this easily, so the two platforms felt
 * inconsistent ("Telegram has a refresh limit, Discord doesn't").
 *
 * This transformer intercepts every outgoing Bot API call for a session's Bot
 * instance and, specifically on a 429 flood-control response, waits exactly
 * the duration Telegram asks for (`retry_after`, in seconds) and then
 * transparently retries the same call. From the caller's perspective (any
 * command's onClick/onCommand handler) the request just resolves successfully
 * a little later — no error, no code change needed in individual commands.
 *
 * Bounded by MAX_ATTEMPTS and MAX_RETRY_AFTER_SECONDS so a pathological/
 * malicious flood-control response can't stall a handler indefinitely.
 */
import type { Transformer } from 'grammy';
import { logger } from '@/engine/modules/logger/logger.lib.js';

const MAX_ATTEMPTS = 3;
// Telegram's own reported retry_after is always honored in full (never truncated) up to
// this ceiling — matches the spirit of the platform-runner's 3s→120s reconnect backoff.
const MAX_RETRY_AFTER_SECONDS = 120;

/**
 * Creates a fresh transformer instance. Each Telegram session/Bot gets its own
 * instance via `activeBot.api.config.use(createAutoRetryTransformer())`.
 */
export function createAutoRetryTransformer(): Transformer {
  const autoRetry: Transformer = async (prev, method, payload, signal) => {
    let attempt = 0;

    for (;;) {
      const result = await prev(method, payload, signal);
      if (result.ok) return result;

      const retryAfter = result.parameters?.retry_after;
      const isFloodControl =
        result.error_code === 429 && typeof retryAfter === 'number';

      if (!isFloodControl || attempt >= MAX_ATTEMPTS) {
        return result;
      }

      attempt += 1;
      const waitSeconds = Math.min(retryAfter, MAX_RETRY_AFTER_SECONDS);
      logger.debug(
        `[telegram] Flood control on "${method}" — retrying in ${waitSeconds}s (attempt ${attempt}/${MAX_ATTEMPTS})`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    }
  };

  return autoRetry;
}
