/**
 * Discord Platform Listener — Orchestrator
 *
 * Wires client.ts, slash-commands.ts, and event-handlers.ts into a single
 * EventEmitter with .start(commands) / .stop() hooks consumed by platform-runner.lib.ts.
 *
 * Emitted events: message, message_reply, event, message_reaction, message_unsend, button_action
 */

import { EventEmitter } from 'events';

import { Routes } from 'discord.js';
import { createLogger } from '@/engine/modules/logger/logger.lib.js';
import { createDiscordClient } from './client.js';
import { registerSlashCommands } from './slash-commands.js';
import { attachEventHandlers } from './event-handlers.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
import {
  PLATFORM_TO_ID,
  Platforms,
} from '@/engine/modules/platform/platform.constants.js';
import {
  registerSlashSync,
  unregisterSlashSync,
} from '@/engine/modules/prefix/slash-sync.lib.js';
import { findSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { prefixManager } from '@/engine/modules/prefix/prefix-manager.lib.js';
import { botRepo } from '@/server/repos/bot.repo.js';
import { runManagedSession } from '@/engine/lib/platform-runner.lib.js';
import { startHeartbeat, stopHeartbeat } from '@/engine/lib/rest-heartbeat.lib.js';

interface DiscordConfig {
  token: string;
  clientId: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

export function createDiscordListener(config: DiscordConfig): EventEmitter & {
  start: (commands: Map<string, Record<string, unknown>>) => Promise<void>;
  stop: (signal?: string) => Promise<void>;
} {
  const emitter = new EventEmitter() as EventEmitter & {
    start: (commands: Map<string, Record<string, unknown>>) => Promise<void>;
    stop: (signal?: string) => Promise<void>;
  };

  const sessionLogger = createLogger({
    userId: config.userId,
    platformId: PLATFORM_TO_ID[Platforms.Discord],
    sessionId: config.sessionId,
  });

  const smKey = `${config.userId}:${Platforms.Discord}:${config.sessionId}`;

  let activeClient: import('discord.js').Client | null = null;
  let heartbeatHandle: NodeJS.Timeout | null = null;
  let activeCommands: Map<string, Record<string, unknown>> | null = null;

  emitter.start = async (
    commands: Map<string, Record<string, unknown>>,
  ): Promise<void> => {
    const cleanup = async (): Promise<void> => {
      unregisterSlashSync(smKey);
      activeCommands = null;
      stopHeartbeat(heartbeatHandle);
      heartbeatHandle = null;
      if (activeClient) {
        activeClient.destroy();
        activeClient = null;
      }
    };

    const boot = async (): Promise<void> => {
      activeCommands = commands;

      // Fetch latest credentials from DB so every retry attempt (including
      // credential-update restarts from the dashboard) uses fresh values.
      const botDetail = await botRepo.getById(config.userId, config.sessionId);
      const token = botDetail
        ? (botDetail.credentials.platform === 'discord'
            ? botDetail.credentials.discordToken
            : undefined) ?? config.token
        : config.token;
      const clientId = botDetail
        ? (botDetail.credentials.platform === 'discord'
            ? botDetail.credentials.discordClientId
            : undefined) ?? config.clientId
        : config.clientId;
      const prefix = botDetail
        ? (botDetail.prefix ?? config.prefix)
        : config.prefix;
      const { userId, sessionId } = config;

      sessionLogger.info('[discord] Starting Listener...');

      // Phase 1: login + gateway ready
      activeClient = await createDiscordClient(token, sessionLogger, (_err) => {
        void sessionManager.markInactive(smKey);
      });

      // Phase 2: attach event handlers BEFORE slash registration so no interaction
      // lands while the client is connected-but-deaf during the REST round-trip.
      await attachEventHandlers({
        client: activeClient,
        emitter,
        commands,
        prefix,
        clientId,
        token,
        userId,
        sessionId,
        sessionLogger,
      });

      // Phase 3: register/clear slash commands
      await registerSlashCommands({
        client: activeClient,
        commands,
        prefix,
        clientId,
        token,
        userId,
        sessionId,
        sessionLogger,
      });

      // Keep client.rest's connection to discord.com warm so real-command latency
      // stays low even after a period of inactivity.
      const heartbeatClient = activeClient;
      heartbeatHandle = startHeartbeat(
        () => heartbeatClient.rest.get(Routes.gateway()),
        sessionLogger,
        '[discord]',
      );

      registerSlashSync(smKey, async () => {
        if (!activeClient || !activeCommands) return;
        const livePrefix = prefixManager.getPrefix(userId, Platforms.Discord, sessionId);
        const rows = await findSessionCommands(userId, Platforms.Discord, sessionId);
        const disabledNames = new Set<string>(
          rows
            .filter((r: { isEnable: boolean; commandName: string }) => !r.isEnable)
            .map((r: { commandName: string }) => r.commandName),
        );
        await registerSlashCommands({
          client: activeClient,
          commands: activeCommands,
          prefix: livePrefix,
          clientId,
          token,
          userId,
          sessionId,
          sessionLogger,
          disabledNames,
          forceRegister: true,
        });
      });

      sessionLogger.info('[discord] Listener active');
    };

    await runManagedSession({ smKey, sessionLogger, label: '[discord]', boot, cleanup });
  };

  emitter.stop = async (_signal?: string): Promise<void> => {
    if (sessionManager.isLocked(smKey)) return;

    sessionManager.markLocked(smKey);
    try {
      sessionLogger.info('[discord] Stopping Listener...');
      unregisterSlashSync(smKey);
      activeCommands = null;
      stopHeartbeat(heartbeatHandle);
      heartbeatHandle = null;
      if (activeClient) {
        activeClient.destroy();
        activeClient = null;
        sessionLogger.info('[discord] Session stopped.');
      }
    } finally {
      sessionManager.markUnlocked(smKey);
    }
  };

  return emitter;
}
