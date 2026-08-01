/**
 * Telegram Platform Listener — Factory
 *
 * Wraps grammY and delegates lifecycle steps to slash-commands.ts, handlers.ts,
 * and platform-runner.lib.ts (exponential-backoff retry loop).
 *
 * Boot order (all handlers must be registered BEFORE bot.start()):
 *   1. Construct Bot + validate token (getMe)
 *   2. Register or clear slash command menu
 *   3. Attach update handlers
 *   4. Start long-polling via @grammyjs/runner (or setWebhook in webhook mode)
 */
import { EventEmitter } from 'events';
import { Bot, webhookCallback } from 'grammy';
import { run, type RunnerHandle } from '@grammyjs/runner';
import { createLogger } from '@/engine/modules/logger/logger.lib.js';
import type { TelegramConfig, TelegramEmitter } from './types.js';
import { registerSlashMenu } from './slash-commands.js';
import { attachHandlers } from './handlers.js';
import { createAutoRetryTransformer } from './lib/auto-retry.transformer.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
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
import { runManagedSession } from '@/engine/lib/platform-runner.lib.js';
import { startHeartbeat, stopHeartbeat } from '@/engine/lib/rest-heartbeat.lib.js';

export function createTelegramListener(config: TelegramConfig): TelegramEmitter {
  const emitter = new EventEmitter() as TelegramEmitter;
  let activeBot: Bot | null = null;
  let activeRunner: RunnerHandle | null = null;
  let heartbeatHandle: NodeJS.Timeout | null = null;
  let activeCommands: Map<string, Record<string, unknown>> | null = null;

  const sessionLogger = createLogger({
    userId: config.userId,
    platformId: PLATFORM_TO_ID[Platforms.Telegram],
    sessionId: config.sessionId,
  });

  const smKey = `${config.userId}:${Platforms.Telegram}:${config.sessionId}`;

  emitter.start = async (
    commands: Map<string, Record<string, unknown>>,
  ): Promise<void> => {
    const cleanup = async (): Promise<void> => {
      unregisterSlashSync(smKey);
      unregisterTelegramWebhookHandler(`${config.userId}:${config.sessionId}`);
      activeCommands = null;
      stopHeartbeat(heartbeatHandle);
      heartbeatHandle = null;
      if (activeRunner && activeRunner.isRunning()) await activeRunner.stop();
      activeRunner = null;
      if (activeBot) {
        await activeBot.stop();
        activeBot = null;
      }
    };

    const boot = async (): Promise<void> => {
      activeCommands = commands;

      sessionLogger.info('[telegram] Starting Listener...');

      // Fetch latest credentials from DB so every retry attempt uses fresh values.
      const botDetail = await botRepo.getById(config.userId, config.sessionId);
      const botToken = botDetail
        ? (botDetail.credentials.platform === 'telegram'
            ? botDetail.credentials.telegramToken
            : undefined) ?? config.botToken
        : config.botToken;
      const prefix = botDetail ? (botDetail.prefix ?? config.prefix) : config.prefix;

      activeBot = new Bot(botToken);

      // Absorb Telegram 429 flood-control responses transparently.
      activeBot.api.config.use(createAutoRetryTransformer());

      // Validate token before attaching handlers — lets the runner classify 401
      // as a permanent auth error instead of an unhandledRejection crash.
      try {
        await activeBot.api.getMe();
      } catch (err) {
        activeBot = null;
        throw err;
      }

      await registerSlashMenu(
        activeBot,
        commands,
        prefix,
        config.userId,
        config.sessionId,
        sessionLogger,
      );

      attachHandlers(activeBot, emitter, prefix, config.userId, config.sessionId);

      // Keep activeBot.api's connection to api.telegram.org warm.
      const heartbeatBot = activeBot;
      heartbeatHandle = startHeartbeat(
        () => heartbeatBot.api.getMe(),
        sessionLogger,
        '[telegram]',
      );

      activeBot.catch((err) => {
        sessionLogger.error('[telegram] Handler error (session continues)', {
          error: err.error,
        });
      });

      const rawWebhookDomain = env.TELEGRAM_WEBHOOK_DOMAIN;
      if (rawWebhookDomain) {
        const domain = rawWebhookDomain.replace(/^https?:\/\//, '');
        const webhookPath = `/api/v1/telegram-webhook/${config.userId}/${config.sessionId}`;
        const secretToken = generateTelegramSecretToken(config.userId, config.sessionId);
        await activeBot.api.setWebhook(`https://${domain}${webhookPath}`, {
          secret_token: secretToken,
          allowed_updates: ['message', 'message_reaction', 'message_reaction_count', 'callback_query'],
        });
        const handler = webhookCallback(activeBot, 'http', { secretToken });
        registerTelegramWebhookHandler(`${config.userId}:${config.sessionId}`, handler);
        sessionLogger.info(
          `[telegram] Webhook mode active — Telegram will POST to https://${domain}${webhookPath}`,
        );
      } else {
        // @grammyjs/runner dispatches fetched updates concurrently, preserving per-chat order.
        activeRunner = run(activeBot, {
          runner: {
            fetch: {
              allowed_updates: ['message', 'message_reaction', 'message_reaction_count', 'callback_query'],
            },
          },
        });
        activeRunner.task()?.catch((err: unknown) => {
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
        sessionLogger.info('[telegram] Bot running (long-polling, concurrent via @grammyjs/runner).');
      }

      sessionLogger.info('[telegram] Listener active');

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
        const disabledNames = new Set<string>(
          rows
            .filter((r: { isEnable: boolean; commandName: string }) => !r.isEnable)
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
          true,
        );
      });
    };

    await runManagedSession({ smKey, sessionLogger, label: '[telegram]', boot, cleanup });
  };

  emitter.stop = async (_signal?: string): Promise<void> => {
    if (sessionManager.isLocked(smKey)) return;

    sessionManager.markLocked(smKey);
    try {
      sessionLogger.info('[telegram] Stopping Listener...');
      unregisterSlashSync(smKey);
      unregisterTelegramWebhookHandler(`${config.userId}:${config.sessionId}`);
      activeCommands = null;
      stopHeartbeat(heartbeatHandle);
      heartbeatHandle = null;
      if (activeRunner && activeRunner.isRunning()) await activeRunner.stop();
      activeRunner = null;
      if (activeBot) {
        await activeBot.stop();
        activeBot = null;
      }
    } finally {
      sessionManager.markUnlocked(smKey);
    }
  };

  return emitter;
}
