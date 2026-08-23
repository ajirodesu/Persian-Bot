/**
 * REST Keep-Alive Heartbeat
 *
 * Fires a cheap ping immediately and then on a fixed interval to keep the
 * underlying HTTPS connection pool (undici) open between real commands.
 * Without this, any idle gap causes the socket to close; the next command
 * then pays a full TCP+TLS re-handshake that shows up as a latency spike.
 *
 * 20 s interval stays below undici's default ~30 s idle-socket timeout.
 * The immediate fire closes the gap between boot and the first tick.
 */

const DEFAULT_INTERVAL_MS = 20_000;

export interface HeartbeatLogger {
  warn: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Starts a keep-alive heartbeat. Fires once immediately, then every `intervalMs`.
 * Returns a handle for `stopHeartbeat()`. All errors are swallowed — a missed
 * ping must never crash or destabilize the session.
 */
export function startHeartbeat(
  ping: () => Promise<unknown>,
  logger: HeartbeatLogger,
  label: string,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): NodeJS.Timeout {
  ping().catch((err: unknown) => {
    logger.warn(`${label} keep-alive initial ping failed (non-fatal)`, { error: err });
  });

  // unref'd so an unstopped heartbeat can never keep the process alive on
  // shutdown — matching every other long-lived timer in the app.
  const timer = setInterval(() => {
    ping().catch((err: unknown) => {
      logger.warn(`${label} keep-alive heartbeat failed (non-fatal)`, { error: err });
    });
  }, intervalMs);
  timer.unref();
  return timer;
}

export function stopHeartbeat(handle: NodeJS.Timeout | null): void {
  if (handle) clearInterval(handle);
}
