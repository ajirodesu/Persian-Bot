// Side-effect import — must run before any command module loads so all axios
// calls share pooled keep-alive sockets from the start.
import '@/engine/lib/http-agent.lib.js';

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { env } from '@/engine/config/env.config.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { loadSessionConfigs } from '@/engine/modules/session/session-loader.util.js';
import { prefixManager } from '@/engine/modules/prefix/prefix-manager.lib.js';
import {
  handleMessage,
  handleEvent,
  handleButtonAction,
} from '@/engine/controllers/index.js';
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import { createUnifiedPlatformListener } from '@/engine/adapters/platform/index.js';
// Side-effect: registers the default middleware pipeline before platform.start() fires.
import '@/engine/middleware/index.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { upsertSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import {
  commandRegistry,
  eventRegistry,
} from '@/engine/lib/module-registry.lib.js';
import { upsertSessionEvents } from '@/engine/modules/session/bot-session-events.repo.js';
import type { SessionConfigs } from '@/engine/modules/session/session-loader.util.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import { startServer } from '@/server/server.js';
import { createThreadCollectionManager } from '@/engine/lib/db-collection.lib.js';
import { dbReady } from 'database';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Module loaders ────────────────────────────────────────────────────────────

/** Imports every command file concurrently; broken files are skipped with a warning. */
async function loadCommands(): Promise<Map<string, Record<string, unknown>>> {
  const commands = new Map<string, Record<string, unknown>>();
  const dir = path.join(__dirname, '..', 'app', 'commands');

  if (!fs.existsSync(dir)) {
    logger.warn(`⚠️  Commands directory not found: ${dir}`);
    return commands;
  }

  const files = (await fs.promises.readdir(dir)).filter(
    (f) => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts'),
  );

  await Promise.allSettled(
    files.map(async (file) => {
      try {
        const mod = (await import(
          pathToFileURL(path.join(dir, file)).href
        )) as Record<string, unknown>;

        // Multi-command files export `commands: Array<{ meta, onCommand, ... }>`.
        if (Array.isArray(mod['commands'])) {
          for (const rawEntry of mod['commands'] as Array<Record<string, unknown>>) {
            const entryCfg = rawEntry['meta'] as
              | { name?: string; aliases?: string[]; options?: Array<{ name?: string }> }
              | undefined;

            if (!entryCfg?.name) {
              logger.warn(`⚠️  Skipping an entry in ${file}: missing meta.name`);
              continue;
            }
            if (
              typeof rawEntry['onCommand'] !== 'function' &&
              typeof rawEntry['onChat'] !== 'function'
            ) {
              logger.warn(`⚠️  Skipping "${entryCfg.name}" in ${file}: missing onCommand/onChat`);
              continue;
            }

            entryCfg.name = entryCfg.name.toLowerCase();
            if (Array.isArray(entryCfg.options)) {
              for (const opt of entryCfg.options) {
                if (opt && typeof opt.name === 'string') opt.name = opt.name.toLowerCase();
              }
            }

            commands.set(entryCfg.name, rawEntry);
            commandRegistry.set(entryCfg.name, rawEntry);
            logger.info(`Loaded command: ${entryCfg.name} (from ${file})`);

            if (Array.isArray(entryCfg.aliases)) {
              for (const alias of entryCfg.aliases) {
                commands.set(String(alias).toLowerCase(), rawEntry);
                logger.info(`  ↳ Alias: ${String(alias).toLowerCase()}`);
              }
            }
          }
          return;
        }

        const cfg = mod['meta'] as { name?: string; aliases?: string[] } | undefined;

        if (!cfg?.name) { logger.warn(`⚠️  Skipping ${file}: missing meta.name`); return; }
        if (typeof mod['onCommand'] !== 'function' && typeof mod['onChat'] !== 'function') {
          logger.warn(`⚠️  Skipping ${file}: missing onStart/onChat`);
          return;
        }

        // Discord requires lowercase command/option names — normalise at load time.
        if (cfg.name) cfg.name = cfg.name.toLowerCase();
        const rawCfg = mod['meta'] as { options?: Array<{ name?: string }> };
        if (Array.isArray(rawCfg.options)) {
          for (const opt of rawCfg.options) {
            if (opt && typeof opt.name === 'string') opt.name = opt.name.toLowerCase();
          }
        }

        commands.set(cfg.name.toLowerCase(), mod);
        commandRegistry.set(cfg.name.toLowerCase(), mod);
        logger.info(`Loaded command: ${cfg.name}`);

        if (Array.isArray(cfg.aliases)) {
          for (const alias of cfg.aliases) {
            commands.set(String(alias).toLowerCase(), mod);
            logger.info(`  ↳ Alias: ${String(alias).toLowerCase()}`);
          }
        }
      } catch (err) {
        logger.error(`❌ Failed to load command ${file}`, { error: err });
      }
    }),
  );

  logger.info(`Loaded ${commands.size} command(s)`);
  return commands;
}

/** Imports every event file concurrently; one file may register multiple event types. */
async function loadEventModules(): Promise<Map<string, Array<Record<string, unknown>>>> {
  const events = new Map<string, Array<Record<string, unknown>>>();
  const dir = path.join(__dirname, '..', 'app', 'events');

  if (!fs.existsSync(dir)) {
    logger.warn(`⚠️  Events directory not found: ${dir}`);
    return events;
  }

  const files = (await fs.promises.readdir(dir)).filter(
    (f) => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts'),
  );

  await Promise.allSettled(
    files.map(async (file) => {
      try {
        const mod = (await import(
          pathToFileURL(path.join(dir, file)).href
        )) as Record<string, unknown>;
        const cfg = mod['meta'] as
          | { name?: string; eventType?: string[]; onEvent?: (...args: unknown[]) => unknown }
          | undefined;

        if (!cfg?.name || !Array.isArray(cfg.eventType)) return;

        if (typeof mod['onEvent'] !== 'function') {
          logger.warn(`⚠️  Skipping ${file}: missing onEvent handler`);
          return;
        }

        for (const type of cfg.eventType) {
          if (!events.has(type)) events.set(type, []);
          events.get(type)!.push(mod);
        }
        eventRegistry.set(cfg.name.toLowerCase(), mod);
        logger.info(`Loaded event handler: ${cfg.name}`);
      } catch (err) {
        logger.error(`Failed to load event ${file}`, { error: err });
      }
    }),
  );

  return events;
}

// ── Registry sync ─────────────────────────────────────────────────────────────

/**
 * Upserts command/event names into the DB for every active session so the
 * dashboard can list and toggle them. Existing isEnable = false rows survive
 * restarts — only missing rows are created.
 */
async function syncCommandsAndEvents(
  commands: Map<string, Record<string, unknown>>,
  eventModules: Map<string, Array<Record<string, unknown>>>,
  sessionConfigs: SessionConfigs,
): Promise<void> {
  const allSessions = [
    ...sessionConfigs.discord.map((s) => ({
      userId: s.userId,
      sessionId: s.sessionId,
      platform: Platforms.Discord,
    })),
    ...sessionConfigs.telegram.map((s) => ({
      userId: s.userId,
      sessionId: s.sessionId,
      platform: Platforms.Telegram,
    })),
  ];

  await Promise.all(
    allSessions.map(async (sess) => {
      const cmdList = new Set<string>();
      for (const mod of commands.values()) {
        if (isPlatformAllowed(mod, sess.platform)) {
          const cfg = mod['meta'] as { name?: string } | undefined;
          if (cfg?.name) cmdList.add(cfg.name.toLowerCase());
        }
      }

      const evtList = new Set<string>();
      for (const handlers of eventModules.values()) {
        for (const mod of handlers) {
          if (isPlatformAllowed(mod, sess.platform)) {
            const cfg = mod['meta'] as { name?: string } | undefined;
            if (cfg?.name) evtList.add(cfg.name.toLowerCase());
          }
        }
      }

      const cmdArr = [...cmdList];
      const evtArr = [...evtList];

      await Promise.all([
        cmdArr.length > 0
          ? upsertSessionCommands(sess.userId, sess.platform, sess.sessionId, cmdArr)
          : Promise.resolve(),
        evtArr.length > 0
          ? upsertSessionEvents(sess.userId, sess.platform, sess.sessionId, evtArr)
          : Promise.resolve(),
      ]);
    }),
  );

  logger.info(`[app] Synced commands and events for ${allSessions.length} session(s)`);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('Cat-Bot - loading modules...');
  logger.info(`Environment: ${env.NODE_ENV}`);

  if (dbReady !== undefined) await dbReady;

  // DB query and disk imports are independent — run all three concurrently.
  const [commands, eventModules, sessionConfigs] = await Promise.all([
    loadCommands(),
    loadEventModules(),
    loadSessionConfigs(),
  ]);

  logger.info('Cat-Bot - creating platform listeners...');

  await syncCommandsAndEvents(commands, eventModules, sessionConfigs);

  // Warn about Telegram-incompatible command meta once at startup.
  const hasTelegramSlashSession = sessionConfigs.telegram.some((c) => c.prefix === '/');
  if (hasTelegramSlashSession) {
    for (const [, mod] of commands) {
      const cfg = mod['meta'] as { name?: string; description?: string } | undefined;
      if (!cfg?.name) continue;
      if (cfg.name.includes('-')) {
        logger.warn(
          `[app] Telegram command name "${cfg.name}" contains hyphens — not supported, will be registered as "${cfg.name.replace(/-/g, '_')}"`,
        );
      }
      if (cfg.description && /\p{Extended_Pictographic}/u.test(cfg.description)) {
        logger.warn(
          `[app] Telegram command "${cfg.name}" description contains emoji — not supported, emoji will be stripped`,
        );
      }
    }
  }

  const platform = createUnifiedPlatformListener({
    discord: sessionConfigs.discord,
    telegram: sessionConfigs.telegram,
  });

  // Restores a thread's custom prefix from DB on the first message seen after restart.
  async function restoreThreadPrefix(
    threadID: string,
    native: import('@/engine/types/controller.types.js').NativeContext,
  ): Promise<void> {
    if (!native.userId || !native.sessionId) return;
    if (prefixManager.getThreadPrefix(threadID) !== undefined) return;
    try {
      const threadColl = createThreadCollectionManager(
        native.userId,
        native.platform,
        native.sessionId,
      )(threadID);
      if (await threadColl.isCollectionExist('settings')) {
        const settings = await threadColl.getCollection('settings');
        const stored = (await settings.get('prefix')) as string | undefined;
        if (stored) prefixManager.setThreadPrefix(threadID, stored);
      }
    } catch {
      /* fail-open — falls back to session prefix */
    }
  }

  // When session prefix is '/' and a thread has a custom prefix, honour both:
  // slash-menu commands use '/', text commands use the thread prefix.
  function resolveLivePrefix(
    payload: Record<string, unknown>,
    native: import('@/engine/types/controller.types.js').NativeContext,
    sessionPrefix: string,
    threadPrefix: string | undefined,
  ): string {
    if (
      sessionPrefix === '/' &&
      threadPrefix !== undefined &&
      threadPrefix !== '/' &&
      (native.platform === Platforms.Discord || native.platform === Platforms.Telegram)
    ) {
      const body = ((payload.event as Record<string, unknown>)['message'] ?? '') as string;
      if (body.startsWith('/')) return '/';
    }
    return threadPrefix ?? sessionPrefix;
  }

  // ── Event routing ─────────────────────────────────────────────────────────

  platform.on('message', async (payload: Record<string, unknown>) => {
    const native = payload.native as import('@/engine/types/controller.types.js').NativeContext;
    const threadID = (payload.event as Record<string, unknown>)['threadID'] as string | undefined;
    const sessionPrefix = prefixManager.getPrefix(
      native.userId ?? '',
      native.platform,
      native.sessionId ?? '',
    );
    if (threadID) await restoreThreadPrefix(threadID, native);
    const threadPrefix = threadID ? prefixManager.getThreadPrefix(threadID) : undefined;
    const livePrefix = resolveLivePrefix(payload, native, sessionPrefix, threadPrefix);
    await handleMessage(payload.api as UnifiedApi, payload.event as Record<string, unknown>, commands, eventModules, livePrefix, native);
  });

  platform.on('message_reply', async (payload: Record<string, unknown>) => {
    const native = payload.native as import('@/engine/types/controller.types.js').NativeContext;
    const threadID = (payload.event as Record<string, unknown>)['threadID'] as string | undefined;
    const sessionPrefix = prefixManager.getPrefix(
      native.userId ?? '',
      native.platform,
      native.sessionId ?? '',
    );
    if (threadID) await restoreThreadPrefix(threadID, native);
    const threadPrefix = threadID ? prefixManager.getThreadPrefix(threadID) : undefined;
    const livePrefix = resolveLivePrefix(payload, native, sessionPrefix, threadPrefix);
    await handleMessage(payload.api as UnifiedApi, payload.event as Record<string, unknown>, commands, eventModules, livePrefix, native);
  });

  platform.on('event', async (payload: Record<string, unknown>) => {
    await handleEvent(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      eventModules,
      payload.native as import('@/engine/types/controller.types.js').NativeContext,
    );
  });

  platform.on('message_reaction', async (payload: Record<string, unknown>) => {
    await handleEvent(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      eventModules,
      payload.native as import('@/engine/types/controller.types.js').NativeContext,
      commands,
    );
  });

  platform.on('message_unsend', async (payload: Record<string, unknown>) => {
    await handleEvent(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      eventModules,
      payload.native as import('@/engine/types/controller.types.js').NativeContext,
    );
  });

  platform.on('button_action', async (payload: Record<string, unknown>) => {
    await handleButtonAction(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      commands,
      payload.native as import('@/engine/types/controller.types.js').NativeContext,
    );
  });

  logger.info('Cat-Bot - starting all platforms...');
  platform.start(commands);
  logger.info('Cat-Bot — all platform listeners wired');

  startServer();
}

// ── Signal handlers ───────────────────────────────────────────────────────────
// Registered once here so N platform sessions never stack duplicate listeners.

async function handleShutdown(signal: string, exitCode: number): Promise<void> {
  logger.info(`🛑 [app] Received ${signal} — stopping all platform sessions...`);
  await sessionManager.stopAll(signal);
  process.exit(exitCode);
}

process.once('SIGINT', () => { void handleShutdown('SIGINT', 0); });
process.once('SIGTERM', () => { void handleShutdown('SIGTERM', 0); });
process.once('uncaughtException', (err: Error) => {
  logger.error('💀 [app] Uncaught exception', { error: err });
});
process.once('unhandledRejection', (reason: unknown) => {
  logger.error('💀 [app] Unhandled rejection', { error: reason });
});

main().catch((err: unknown) => {
  logger.error('💀 Fatal: could not start Cat-Bot', { error: err });
  process.exit(1);
});
