/**
 * Platform Session Runner — Centralized Retry Orchestrator
 *
 * Single declaration of the exponential-backoff startup retry pattern shared by ALL
 * platform listeners (Discord, Telegram).
 *
 * WHY THIS EXISTS:
 *   Before this module, each listener copy-pasted ~40 identical lines of:
 *     isLocked/isRetrying guards → AbortController → markRetrying → withRetry loop →
 *     markLocked/Unlocked → markActive/Inactive → markNotRetrying
 *   Any divergence between those copies was a latent bug.
 *
 * AFTER:
 *   Each platform provides two thin hooks (boot / cleanup). All orchestration lives
 *   here — one path, one set of constants, zero nested retry loops.
 *
 * Singleton guarantee:
 *   sessionManager.isLocked + sessionManager.isRetrying (both checked synchronously
 *   before any await) ensure exactly ONE retry loop runs per session key at any moment.
 *   The AbortController allows an external start() call (e.g. from an MQTT error handler)
 *   to cancel a sleeping back-off loop and boot a fresh session with the latest DB creds.
 *
 * Lifecycle ownership — platforms MUST NOT call these directly:
 *   markRetrying / markNotRetrying  — retry slot management
 *   markInactiveTransient           — fired on entry and on every failed attempt (no DB write,
 *                                     preserves isRunning=true so sessions resume on restart)
 *   markInactive                    — fired ONLY after all retries are exhausted (writes DB)
 *   markActive                      — fired ONLY after boot() resolves without throwing
 *   markLocked / markUnlocked       — transition guard around each boot() invocation
 */

import { withRetry, isAuthError } from './retry.lib.js';
import { sessionManager } from '../modules/session/session-manager.lib.js';
import type { SessionLogger } from '../modules/logger/logger.lib.js';

/**
 * Platform-specific hooks for runManagedSession.
 * Platforms implement only these two functions — all retry orchestration lives in the runner.
 */
export interface ManagedSessionOptions {
  /** Canonical session key: `${userId}:${platform}:${sessionId}` */
  smKey: string;
  /** Session-scoped logger used for retry warning/error messages. */
  sessionLogger: SessionLogger;
  /**
   * Log prefix identifying the platform, e.g. '[discord]', '[telegram]'.
   * Included in every retry log line.
   */
  label: string;
  /**
   * Platform-specific startup routine. Must throw on failure so the runner can
   * classify the error (auth → permanent failure; transient → retry with backoff).
   * Called under markLocked — concurrent start()/stop() calls are blocked while
   * boot is in flight.
   * Do NOT call sessionManager.markActive inside boot — the runner owns that call.
   */
  boot: () => Promise<void>;
  /**
   * Tears down any partial state left over from a failed attempt so the next
   * retry starts clean (e.g. destroy previous Discord client, stop previous
   * MQTT connection). Called only on non-first attempts. Must never throw —
   * errors are silently swallowed so they cannot block the next attempt.
   */
  cleanup: () => Promise<void>;
}

/**
 * Runs a managed platform session with exponential-backoff retry (10 attempts, 3 s → 120 s).
 *
 * Guard semantics (both synchronous — no race window):
 *   isLocked   — another start/stop transition is actively in flight → return immediately
 *   isRetrying — a back-off sleep is already in progress for this key → return immediately
 *
 * The retry slot (markRetrying) is claimed synchronously immediately after the guards
 * so a rapid second caller sees isRetrying = true and exits without spawning a parallel loop.
 */
export async function runManagedSession(
  opts: ManagedSessionOptions,
): Promise<void> {
  const { smKey, sessionLogger, label, boot, cleanup } = opts;

  if (sessionManager.isLocked(smKey)) return;
  if (sessionManager.isRetrying(smKey)) return;

  // Claim retry slot synchronously before any await — prevents a rapid second call from
  // passing the isRetrying guard and spawning a parallel loop.
  const controller = new AbortController();
  const retryToken = sessionManager.markRetrying(smKey, () =>
    controller.abort(),
  );

  // Update in-memory state and dashboard without writing isRunning=false to the DB.
  // Using markInactiveTransient here is critical for session persistence across restarts:
  // if the process is killed between this call and markActive completing, isRunning
  // stays true in the DB so session-loader.util.ts auto-resumes the session on next boot.
  // markInactive (DB write) is reserved for permanent failures only (see .catch below).
  sessionManager.markInactiveTransient(smKey);

  let isFirstAttempt = true;

  try {
    await withRetry(
      async () => {
        // Exit immediately if a concurrent start() aborted this loop to spawn a fresh session.
        if (controller.signal.aborted) throw new Error('Retry aborted');

        // Tear down partial state from the previous failed attempt.
        // On the first attempt there is nothing to clean up.
        if (!isFirstAttempt) {
          try {
            await cleanup();
          } catch {
            // Non-fatal — a failed cleanup must not block the next start attempt.
          }
        }
        isFirstAttempt = false;

        sessionManager.markLocked(smKey);
        try {
          await boot();
          // markActive fires only after boot() resolves successfully — the dashboard
          // never shows a partially-initialised session as online.
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
          // Keep dashboard in sync during back-off without writing false to the DB —
          // same reasoning as the entry call above: transient only to preserve DB state.
          sessionManager.markInactiveTransient(smKey);
        },
        // Auth errors (bad token, blocked session) are permanent — stop retrying immediately.
        shouldRetry: (err) => !isAuthError(err),
      },
    ).catch((err: unknown) => {
      // Aborted by a concurrent start() that cancelled this loop — skip the failure log.
      if (controller.signal.aborted) return;
      sessionLogger.error(
        `${label} Permanent startup failure after 10 attempts — session offline`,
        { error: err },
      );
      void sessionManager.markInactive(smKey);
    });
  } finally {
    // Token-gated clear: only removes this invocation's entry so a concurrent
    // start() call's newer registration is never accidentally evicted.
    sessionManager.markNotRetrying(smKey, retryToken);
  }
}
