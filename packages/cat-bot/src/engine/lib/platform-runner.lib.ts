/**
 * Platform Session Runner — centralized exponential-backoff startup retry orchestrator.
 *
 * All platform listeners (Discord, Telegram) share this single path.
 * Each platform provides two thin hooks (boot / cleanup); all retry orchestration lives here.
 *
 * Singleton guarantee: isLocked + isRetrying (both synchronous) ensure exactly one retry loop
 * runs per session key. An AbortController allows an external start() call to cancel a sleeping
 * back-off loop and boot a fresh session with the latest DB credentials.
 *
 * Lifecycle ownership — platforms must NOT call these directly:
 *   markRetrying / markNotRetrying  — retry slot management
 *   markInactiveTransient           — fired on entry and on each failed attempt (no DB write;
 *                                     preserves isRunning=true so sessions resume on restart)
 *   markInactive                    — fired ONLY after all retries exhausted (writes DB)
 *   markActive                      — fired ONLY after boot() resolves without throwing
 *   markLocked / markUnlocked       — transition guard around each boot() invocation
 */

import { withRetry, isAuthError } from './retry.lib.js';
import { sessionManager } from '../modules/session/session-manager.lib.js';
import type { SessionLogger } from '../modules/logger/logger.lib.js';

export interface ManagedSessionOptions {
  /** Canonical session key: `${userId}:${platform}:${sessionId}` */
  smKey: string;
  sessionLogger: SessionLogger;
  /** Log prefix, e.g. '[discord]', '[telegram]'. Included in every retry log line. */
  label: string;
  /**
   * Platform-specific startup routine. Must throw on failure.
   * Called under markLocked — concurrent start()/stop() calls are blocked while in flight.
   * Do NOT call sessionManager.markActive inside boot — the runner owns that call.
   */
  boot: () => Promise<void>;
  /**
   * Tears down partial state from the previous failed attempt so the next retry starts clean.
   * Called only on non-first attempts. Must never throw — errors are silently swallowed.
   */
  cleanup: () => Promise<void>;
}

/**
 * Runs a managed platform session with exponential-backoff retry (10 attempts, 3 s → 120 s).
 *
 * Guards (both synchronous — no race window):
 *   isLocked   — another start/stop transition is in flight → return immediately
 *   isRetrying — a back-off sleep is already running for this key → return immediately
 *
 * The retry slot is claimed synchronously before any await so a rapid second caller sees
 * isRetrying = true and exits without spawning a parallel loop.
 */
export async function runManagedSession(opts: ManagedSessionOptions): Promise<void> {
  const { smKey, sessionLogger, label, boot, cleanup } = opts;

  if (sessionManager.isLocked(smKey)) return;
  if (sessionManager.isRetrying(smKey)) return;

  const controller = new AbortController();
  const retryToken = sessionManager.markRetrying(smKey, () => controller.abort());

  // markInactiveTransient (no DB write) preserves isRunning=true so session-loader auto-resumes
  // on process restart. markInactive (DB write) is reserved for permanent failures only.
  sessionManager.markInactiveTransient(smKey);

  let isFirstAttempt = true;

  try {
    await withRetry(
      async () => {
        if (controller.signal.aborted) throw new Error('Retry aborted');
        if (!isFirstAttempt) {
          try { await cleanup(); } catch { /* non-fatal */ }
        }
        isFirstAttempt = false;

        sessionManager.markLocked(smKey);
        try {
          await boot();
          await sessionManager.markActive(smKey);
        } finally {
          sessionManager.markUnlocked(smKey);
        }
      },
      {
        signal: controller.signal,
        maxAttempts: 10,
        initialDelayMs: 3_000,
        backoffFactor: 2,
        maxDelayMs: 120_000,
        onRetry: (attempt, err) => {
          sessionLogger.warn(
            `${label} Start attempt ${attempt}/10 failed — retrying with backoff`,
            { error: err },
          );
          sessionManager.markInactiveTransient(smKey);
        },
        shouldRetry: (err) => !isAuthError(err),
      },
    ).catch((err: unknown) => {
      if (controller.signal.aborted) return;
      sessionLogger.error(`${label} Permanent startup failure after 10 attempts — session offline`, { error: err });
      void sessionManager.markInactive(smKey);
    });
  } finally {
    sessionManager.markNotRetrying(smKey, retryToken);
  }
}
