/**
 * Telegram Platform Listener — Factory
 *
 * Creates an EventEmitter-based platform listener that wraps grammY.
 * Delegates each lifecycle step to focused modules:
 *   - types.ts          → TelegramConfig, TelegramEmitter
 *   - slash-commands.ts → Command menu registration across broadcast scopes
 *   - handlers.ts       → All grammY update handler registrations
 *
 * Retry architecture:
 *   emitter.start() delegates to runManagedSession() (platform-runner.lib.ts) which
 *   owns the exponential-backoff loop (10 attempts, 3 s → 120 s), isLocked / isRetrying
 *   zombie guards, AbortController cancellation, and markActive / markInactive dashboard
 *   sync. This file provides only boot() and cleanup() hooks to the runner.
 *
 * Lifecycle (per grammY docs — all handlers must be registered BEFORE start):
 *   1. Construct Bot instance
 *   2. Validate bot token (getMe) — 401 → runner classifies as auth error, no retry
 *   3. Register or clear slash command menu across all broadcast scopes
 *   4. Attach all update handlers (they emit typed events on the returned emitter)
 *   5. Call bot.start() with allowedUpdates — polling starts here (webhook: setWebhook + webhookCallback)
 */
import { EventEmitter } from 'events';
import { Bot, webhookCallback } from 'grammy';
import { createLogger } from '@/engine/modules/logger/logger.lib.js';
import type { TelegramConfig, TelegramEmitter } from './types.js';
import { registerSlashMenu } from './slash-commands.js';
import { attachHandlers } from './handlers.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
// isAuthError retained — still needed inside boot() to classify long-poll errors mid-session.
// withRetry removed — runner (platform-runner.lib.ts) now owns the retry loop.
import { isAuthError } from '@/engine/lib/retry.lib.js';
import {
  PLATFORM_TO_ID,
  Platforms,
} from '@/engine/modules/platform/platform.constants.js';
import { env } from '@/engine/config/env.config.js';
import {
  registerSlashSync,
  unregisterSlashSync,
} from '@/engine/modules/prefix/slash-sync.lib.js';
import { findSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { prefixManager } from '@/engine/modules/prefix/prefix-manager.lib.js';
import {
  registerTelegramWebhookHandler,
  unregisterTelegramWebhookHandler,
} from '@/engine/modules/session/telegram-webhook.registry.js';
import { generateTelegramSecretToken } from '@/server/utils/hash.util.js';
import { botRepo } from '@/server/repos/bot.repo.js';
// Centralized retry runner — replaces the inline withRetry + AbortController boilerplate.
import { runManagedSession } from '@/engine/lib/platform-runner.lib.js';

/**
 * Creates a Telegram platform listener.
 * Register .on() handlers on the returned emitter BEFORE calling start().
 */
export function createTelegramListener(
  config: TelegramConfig,
): TelegramEmitter {
  const emitter = new EventEmitter() as TelegramEmitter;
  let activeBot: Bot | null = null;

  // Retained across start() calls so the slash-sync callback always references the current Map.
  let activeCommands: Map<string, Record<string, unknown>> | null = null;

  const sessionLogger = createLogger({
    userId: config.userId,
    platformId: PLATFORM_TO_ID[Platforms.Telegram],
    sessionId: config.sessionId,
  });

  // Hoisted to factory scope — eliminates duplicate string construction in start() and stop().
  const smKey = `${config.userId}:${Platforms.Telegram}:${config.sessionId}`;

  emitter.start = async (
    commands: Map<string, Record<string, unknown>>,
  ): Promise<void> => {
    /**
     * Tears down partial state between retry attempts.
     * Called by runManagedSession before each non-first attempt — never directly.
     */
    const cleanup = async (): Promise<void> => {
      unregisterSlashSync(smKey);
      unregisterTelegramWebhookHandler(`${config.userId}:${config.sessionId}`);
      activeCommands = null;
      if (activeBot) {
        // grammY's stop() resolves without throwing when the bot was never started
        // (e.g. boot() set activeBot but aborted before start()) — no try/catch needed.
        await activeBot.stop();
        activeBot = null;
      }
    };

    /**
     * Platform-specific boot routine. Called once per retry attempt under markLocked.
     * markActive is NOT called here — runManagedSession calls it after boot() resolves.
     */
    const boot = async (): Promise<void> => {
      // Restore from the start() parameter on every attempt — cleanup() sets it to null.
      activeCommands = commands;

      sessionLogger.info('[telegram] Starting Listener...');

      // WHY: Fetching inside boot guarantees every attempt uses the latest DB credentials —
      // covers credential-update auto-restarts triggered via the dashboard.
      const botDetail = await botRepo.getById(config.userId, config.sessionId);
      const botToken = botDetail
        ? ((botDetail.credentials as any).telegramToken ?? config.botToken)
        : config.botToken;
      const prefix = botDetail
        ? (botDetail.prefix ?? config.prefix)
        : config.prefix;
      activeBot = new Bot(botToken);

      // Validate bot token before registering handlers or starting.
      // bot.start() calls getMe() internally as part of init() — if it fails, the rejection
      // escapes to unhandledRejection and can crash every platform session. Calling getMe() here
      // lets the runner classify 401 → auth error → no retry (immediate permanent failure).
      try {
        await activeBot.api.getMe();
      } catch (err) {
        activeBot = null; // Release — a fresh instance is created on the next attempt
        throw err;
      }

      // Step 1: Register or clear slash command menu across all broadcast scopes
      await registerSlashMenu(
        activeBot,
        commands,
        prefix,
        config.userId,
        config.sessionId,
        sessionLogger,
      );

      // Step 2: Attach all update handlers — must happen before bot.start()
      attachHandlers(
        activeBot,
        emitter,
        prefix,
        config.userId,
        config.sessionId,
      );

      // Catch errors thrown inside any grammY middleware or handler.
      // Without this, handler rejections surface as unhandledRejection which crashes
      // Node ≥15 and takes down every other platform session.
      // grammY wraps the original error in a BotError — unwrap via err.error to match
      // the underlying error shape directly.
      activeBot.catch((err) => {
        sessionLogger.error('[telegram] Handler error (session continues)', {
          error: err.error,
        });
      });

      // Step 3: Start receiving updates.
      const rawWebhookDomain = env.TELEGRAM_WEBHOOK_DOMAIN;
      if (rawWebhookDomain) {
        const domain = rawWebhookDomain.replace(/^https?:\/\//, '');
        const webhookPath = `/api/v1/telegram-webhook/${config.userId}/${config.sessionId}`;
        // Derived from ENCRYPTION_KEY + userId + sessionId — unique per session.
        const secretToken = generateTelegramSecretToken(
          config.userId,
          config.sessionId,
        );
        // message_reaction is opt-in since Bot API 7.0 — must mirror allowedUpdates in long-poll.
        await activeBot.api.setWebhook(`https://${domain}${webhookPath}`, {
          secret_token: secretToken,
          allowed_updates: [
            'message',
            'message_reaction',
            'message_reaction_count',
            'callback_query',
          ],
        });
        // grammY has no bot.createWebhook() equivalent — webhookCallback() builds the
        // (req, res) request listener ourselves; the 'http' adapter matches the raw
        // Node.js IncomingMessage/ServerResponse signature server/app.ts invokes it with.
        const handler = webhookCallback(activeBot, 'http', { secretToken });
        registerTelegramWebhookHandler(
          `${config.userId}:${config.sessionId}`,
          handler,
        );
        sessionLogger.info(
          `[telegram] Webhook mode active — Telegram will POST to https://${domain}${webhookPath}`,
        );
      } else {
        // Long-polling fallback — all handlers registered above, then start().
        activeBot
          .start({
            allowed_updates: [
              'message',
              'message_reaction',
              'message_reaction_count',
              'callback_query',
            ],
          })
          .catch((err: unknown) => {
            // grammY's stop() resolves bot.start() normally rather than rejecting it,
            // so any rejection here reflects a genuine polling failure.
            if (isAuthError(err)) {
              sessionLogger.error(
                '[telegram] Session offline — bot token revoked during active polling',
                { error: err },
              );
              void sessionManager.markInactive(smKey);
            } else {
              sessionLogger.warn(
                '[telegram] Polling interrupted (non-fatal; will recover if network restores)',
                { error: err },
              );
            }
          });
        sessionLogger.info('[telegram] Bot running (long-polling).');
      }

      sessionLogger.info('[telegram] Listener active');

      // Register the slash-sync callback AFTER start succeeds.
      // Closure captures activeBot and activeCommands by variable reference so dashboard
      // restarts bind to the current grammY Bot instance without re-registering.
      registerSlashSync(smKey, async () => {
        if (!activeBot || !activeCommands) return;
        const livePrefix = prefixManager.getPrefix(
          config.userId,
          Platforms.Telegram,
          config.sessionId,
        );
        const rows = await findSessionCommands(
          config.userId,
          Platforms.Telegram,
          config.sessionId,
        );
        // Explicitly typed — database exports can fall back to `any`
        const disabledNames = new Set<string>(
          rows
            .filter(
              (r: { isEnable: boolean; commandName: string }) => !r.isEnable,
            )
            .map((r: { commandName: string }) => r.commandName),
        );
        await registerSlashMenu(
          activeBot,
          activeCommands,
          livePrefix,
          config.userId,
          config.sessionId,
          sessionLogger,
          disabledNames,
          true, // forceRegister — dashboard toggle changes the enabled-set, not the config hash
        );
      });
      // markActive NOT called here — runManagedSession calls it after boot() returns.
    };

    await runManagedSession({
      smKey,
      sessionLogger,
      label: '[telegram]',
      boot,
      cleanup,
    });
  };

  emitter.stop = async (_signal?: string): Promise<void> => {
    if (sessionManager.isLocked(smKey)) return;

    sessionManager.markLocked(smKey);
    try {
      sessionLogger.info('[telegram] Stopping Listener...');
      unregisterSlashSync(smKey);
      // Remove webhook handler entry so server/app.ts returns 404 for this dead session
      unregisterTelegramWebhookHandler(`${config.userId}:${config.sessionId}`);
      activeCommands = null;
      if (activeBot) {
        // grammY's stop() resolves without throwing when the bot was never started
        // (e.g. start() may have set activeBot but aborted before start() completed).
        await activeBot.stop();
        activeBot = null;
      }
    } finally {
      sessionManager.markUnlocked(smKey);
    }
  };

  return emitter;
}
