/**
 * REST Keep-Alive Heartbeat
 *
 * Root cause of the 200-400ms+ "cold" ping/uptime readings on Discord and Telegram:
 * chat.replyMessage()/editMessage() on those platforms time an ACTUAL round-trip to
 * discord.com / api.telegram.org (see ping.ts) — that number is real, not an artifact.
 * The slowness comes from the underlying HTTPS connection pool (undici for discord.js,
 * fetch/undici for grammY) tearing down its socket to the platform host after a period
 * of inactivity. The next REST call then pays a fresh DNS + TCP + TLS handshake before
 * the actual API round-trip even starts.
 *
 * Both platform clients already make a REST call during boot (registerSlashCommands /
 * bot.api.getMe()), which briefly warms the pool — but by the time a person actually
 * types a command (seconds to minutes later), that connection has typically already
 * gone idle and been closed. The exact same thing happens after any sufficiently long
 * gap between commands mid-session, independent of restarts.
 *
 * Fix: periodically issue a cheap authenticated call on the SAME client instance used
 * for real sends, on an interval short enough that the pooled connection never goes
 * idle long enough to be reclaimed. This trades a small constant number of extra no-op
 * requests per session for consistently low, accurate first-command latency.
 */

const DEFAULT_INTERVAL_MS = 45_000;

export interface HeartbeatLogger {
  warn: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Starts a recurring keep-alive call. Returns a handle to pass to stopHeartbeat().
 * Failures are swallowed (logged only) — a missed heartbeat must never crash or
 * destabilize the session; the next real command will simply pay the reconnect cost
 * once, same as today.
 */
export function startHeartbeat(
  ping: () => Promise<unknown>,
  logger: HeartbeatLogger,
  label: string,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): NodeJS.Timeout {
  return setInterval(() => {
    ping().catch((err: unknown) => {
      logger.warn(`${label} keep-alive heartbeat failed (non-fatal)`, {
        error: err,
      });
    });
  }, intervalMs);
}

export function stopHeartbeat(handle: NodeJS.Timeout | null): void {
  if (handle) clearInterval(handle);
}
