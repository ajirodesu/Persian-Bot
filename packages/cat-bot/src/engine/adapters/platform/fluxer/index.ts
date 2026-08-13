/**
 * Fluxer Platform Listener — Orchestrator
 *
 * Wires client.ts and event-handlers.ts into a single EventEmitter with
 * .start(commands) / .stop() hooks consumed by platform-runner.lib.ts.
 *
 * Fluxer has no slash-command menu (text-prefix only), so unlike the Discord
 * orchestrator no slash registration or slash-sync wiring is required.
 *
 * Emitted events: message, message_reply, event, message_reaction, message_unsend
 */

import { EventEmitter } from 'events';
import { Routes } from '@fluxerjs/core';
import { createLogger } from '@/engine/modules/logger/logger.lib.js';
import { createFluxerClient } from './client.js';
import { attachEventHandlers } from './event-handlers.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
import {
  PLATFORM_TO_ID,
  Platforms,
} from '@/engine/modules/platform/platform.constants.js';
import { botRepo } from '@/server/repos/bot.repo.js';
import { runManagedSession } from '@/engine/lib/platform-runner.lib.js';
import { startHeartbeat, stopHeartbeat } from '@/engine/lib/rest-heartbeat.lib.js';

interface FluxerConfig {
  token: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

export function createFluxerListener(config: FluxerConfig): EventEmitter & {
  start: (commands: Map<string, Record<string, unknown>>) => Promise<void>;
  stop: (signal?: string) => Promise<void>;
} {
  const emitter = new EventEmitter() as EventEmitter & {
    start: (commands: Map<string, Record<string, unknown>>) => Promise<void>;
    stop: (signal?: string) => Promise<void>;
  };

  const sessionLogger = createLogger({
    userId: config.userId,
    platformId: PLATFORM_TO_ID[Platforms.Fluxer],
    sessionId: config.sessionId,
  });

  const smKey = `${config.userId}:${Platforms.Fluxer}:${config.sessionId}`;

  let activeClient: import('@fluxerjs/core').Client | null = null;
  let heartbeatHandle: NodeJS.Timeout | null = null;

  emitter.start = async (
    _commands: Map<string, Record<string, unknown>>,
  ): Promise<void> => {
    const cleanup = async (): Promise<void> => {
      stopHeartbeat(heartbeatHandle);
      heartbeatHandle = null;
      if (activeClient) {
        activeClient.destroy();
        activeClient = null;
      }
    };

    const boot = async (): Promise<void> => {
      // Fetch latest credentials from DB so every retry attempt (including
      // credential-update restarts from the dashboard) uses fresh values.
      const botDetail = await botRepo.getById(config.userId, config.sessionId);
      const token =
        botDetail &&
        (botDetail.credentials as { platform?: string }).platform === 'fluxer'
          ? (botDetail.credentials as { fluxerToken?: string }).fluxerToken ??
            config.token
          : config.token;
      const prefix = botDetail
        ? (botDetail.prefix ?? config.prefix)
        : config.prefix;
      const { userId, sessionId } = config;

      sessionLogger.info('[fluxer] Starting Listener...');

      // Phase 1: login + gateway ready
      activeClient = await createFluxerClient(token, sessionLogger, (_err) => {
        void sessionManager.markInactive(smKey);
      });

      // Phase 2: attach event handlers BEFORE the heartbeat so no event lands
      // while the client is connected-but-deaf during warmup.
      await attachEventHandlers({
        client: activeClient,
        emitter,
        prefix,
        userId,
        sessionId,
        sessionLogger,
      });

      // Keep client.rest's connection to the Fluxer API warm so real-command
      // latency stays low even after a period of inactivity.
      const heartbeatClient = activeClient;
      heartbeatHandle = startHeartbeat(
        () => heartbeatClient.rest.get(Routes.gatewayBot()),
        sessionLogger,
        '[fluxer]',
      );

      sessionLogger.info('[fluxer] Listener active');
    };

    await runManagedSession({ smKey, sessionLogger, label: '[fluxer]', boot, cleanup });
  };

  emitter.stop = async (_signal?: string): Promise<void> => {
    if (sessionManager.isLocked(smKey)) return;

    sessionManager.markLocked(smKey);
    try {
      sessionLogger.info('[fluxer] Stopping Listener...');
      stopHeartbeat(heartbeatHandle);
      heartbeatHandle = null;
      if (activeClient) {
        activeClient.destroy();
        activeClient = null;
        sessionLogger.info('[fluxer] Session stopped.');
      }
    } finally {
      sessionManager.markUnlocked(smKey);
    }
  };

  return emitter;
}