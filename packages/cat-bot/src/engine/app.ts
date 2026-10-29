// Side-effect import — must run before any command module loads so all axios
// calls share pooled keep-alive sockets from the start.
import { warmPlatformConnections } from '@/engine/lib/http-agent.lib.js';

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { performance } from 'node:perf_hooks';

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
import { eventRegistry } from '@/engine/lib/module-registry.lib.js';
import { loadCommandsFromDirectory } from '@/engine/modules/command/command-loader.lib.js';
import { upsertSessionEvents } from '@/engine/modules/session/bot-session-events.repo.js';
import type { SessionConfigs } from '@/engine/modules/session/session-loader.util.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import { createThreadCollectionManager } from '@/engine/lib/db-collection.lib.js';
import { dbReady } from 'database';
import { createWarmController } from '@/engine/lib/warm-controller.lib.js';
import { prewarmSessions } from '@/engine/modules/session/session-prewarm.lib.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Module loaders ────────────────────────────────────────────────────────────

/** Imports every command file concurrently; broken files are skipped with a warning. */
async function loadCommands(): Promise<Map<string, Record<string, unknown>>> {
  return loadCommandsFromDirectory(
    path.join(__dirname, '..', 'app', 'commands'),
  );
}

/** Imports every event file concurrently; one file may register multiple event types. */
async function loadEventModules(): Promise<
  Map<string, Array<Record<string, unknown>>>
> {
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
          | {
              name?: string;
              type?: string[];
              onEvent?: (...args: unknown[]) => unknown;
            }
          | undefined;

        if (!cfg?.name || !Array.isArray(cfg.type)) return;

        if (typeof mod['onEvent'] !== 'function') {
          logger.warn(`⚠️  Skipping ${file}: missing onEvent handler`);
          return;
        }

        for (const type of cfg.type) {
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
          ? upsertSessionCommands(
              sess.userId,
              sess.platform,
              sess.sessionId,
              cmdArr,
            )
          : Promise.resolve(),
        evtArr.length > 0
          ? upsertSessionEvents(
              sess.userId,
              sess.platform,
              sess.sessionId,
              evtArr,
            )
          : Promise.resolve(),
      ]);
    }),
  );

  logger.info(
    `[app] Synced commands and events for ${allSessions.length} session(s)`,
  );
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const bootStart = performance.now();
  logger.info('Cat-Bot - loading modules...');
  logger.info(`Environment: ${env.NODE_ENV}`);

  // dbReady is the first outbound network call of the boot sequence
  // (Turso/Neon connect over HTTPS via fetch; platform sessions start later
  // and can never throw fatally — they retry per-session in the background).
  // Transient network blips (ETIMEDOUT) are common on this link, so retry
  // with backoff instead of dying on the first failure — a dead backend is
  // worse than a slow boot. Only after the retries are exhausted is the
  // error fatal.
  if (dbReady !== undefined) {
    const DB_BOOT_ATTEMPTS = 5;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= DB_BOOT_ATTEMPTS; attempt += 1) {
      try {
        await dbReady;
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < DB_BOOT_ATTEMPTS) {
          const waitMs = 2000 * attempt;
          logger.warn(
            `[app] Database unreachable (attempt ${attempt}/${DB_BOOT_ATTEMPTS}) — retrying in ${waitMs / 1000}s…`,
            { error: err },
          );
          await new Promise<void>((resolve) => {
            setTimeout(resolve, waitMs);
          });
        }
      }
    }
    if (lastErr !== null) {
      logger.error(
        '[app] Could not reach the database. Check your internet connection, firewall/VPN/proxy rules, and that DATABASE_TYPE plus TURSO_DATABASE_URL (or the Neon equivalent) points at a live, reachable database.',
        { error: lastErr },
      );
      throw lastErr;
    }
  }

  // DB query and disk imports are independent — run all three concurrently.
  const [commands, eventModules, sessionConfigs] = await Promise.all([
    loadCommands(),
    loadEventModules(),
    loadSessionConfigs(),
  ]);

  // The warm-up runs alongside gateway connection instead of gating it. A
  // message that arrives before it finishes waits for the same promise (bounded
  // below), so the first command is still warm — but the bot is online sooner.
  const warmController = createWarmController({
    warm: async () => {
      await prewarmSessions(sessionConfigs);
    },
    freshMs: 12 * 60 * 1000,
    waitMs: 8_000,
  });
  const warmStart = performance.now();
  void warmController.warm().then(() => {
    if (warmController.isWarm()) {
      logger.info(
        `[app] Hot-path cache ready in ${(performance.now() - warmStart).toFixed(0)}ms (${sessionConfigs.discord.length + sessionConfigs.telegram.length} session(s))`,
      );
    } else {
      logger.warn('[app] Hot-path warm-up failed — dispatching with a cold cache');
    }
  });

  // Establish DNS/TLS/keep-alive sockets to the platform APIs before the first
  // message needs them. Best-effort, never awaited.
  warmPlatformConnections({
    discord: sessionConfigs.discord.length > 0,
    telegram: sessionConfigs.telegram.length > 0,
  });

  logger.info('Cat-Bot - creating platform listeners...');

  // Warn about Telegram-incompatible command meta once at startup.
  const hasTelegramSlashSession = sessionConfigs.telegram.some(
    (c) => c.prefix === '/',
  );
  if (hasTelegramSlashSession) {
    for (const [, mod] of commands) {
      const cfg = mod['meta'] as
        { name?: string; description?: string } | undefined;
      if (!cfg?.name) continue;
      if (cfg.name.includes('-')) {
        logger.warn(
          `[app] Telegram command name "${cfg.name}" contains hyphens — not supported, will be registered as "${cfg.name.replace(/-/g, '_')}"`,
        );
      }
      if (
        cfg.description &&
        /\p{Extended_Pictographic}/u.test(cfg.description)
      ) {
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
    // Negative cache fast path: once a thread's custom-prefix state is known this process
    // (loaded from DB, or set/cleared via /prefix), skip the DB entirely. This converts the
    // previous two-DB-round-trip cost per message into a single in-memory Set lookup for the
    // overwhelmingly common case (threads without a custom prefix). Correctness is preserved:
    // every write path (/prefix set, /prefix reset) marks the thread checked, and the set is
    // cleared on full reset, so the only DB reads left happen once per thread after a restart.
    if (prefixManager.isThreadPrefixChecked(threadID)) return;
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
    } finally {
      // Mark checked regardless of outcome — found, absent, or DB error — so subsequent
      // messages never re-query. setThreadPrefix() above already marks it, but the finally
      // also covers the absent/error paths.
      prefixManager.markThreadPrefixChecked(threadID);
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
      (native.platform === Platforms.Discord ||
        native.platform === Platforms.Telegram)
    ) {
      const body = ((payload.event as Record<string, unknown>)['message'] ??
        '') as string;
      if (body.startsWith('/')) return '/';
    }
    return threadPrefix ?? sessionPrefix;
  }

  // ── Event routing ─────────────────────────────────────────────────────────

  platform.on('message', async (payload: Record<string, unknown>) => {
    await warmController.ensureWarm();
    const native =
      payload.native as import('@/engine/types/controller.types.js').NativeContext;
    const threadID = (payload.event as Record<string, unknown>)['threadID'] as
      string | undefined;
    const sessionPrefix = prefixManager.getPrefix(
      native.userId ?? '',
      native.platform,
      native.sessionId ?? '',
    );
    // Slash commands use the session prefix by definition, so a thread's
    // (possibly custom) text prefix cannot change this message. Skip the
    // first-message-per-thread DB read and resolve it in the background for
    // the next text command instead.
    const body =
      ((payload.event as Record<string, unknown>)['message'] ??
        (payload.event as Record<string, unknown>)['body'] ??
        '') as string;
    const slashFastPath =
      sessionPrefix === '/' && body.startsWith('/');
    if (threadID && !slashFastPath) {
      await restoreThreadPrefix(threadID, native);
    }
    const threadPrefix = threadID
      ? prefixManager.getThreadPrefix(threadID)
      : undefined;
    if (threadID && slashFastPath) {
      void restoreThreadPrefix(threadID, native);
    }
    const livePrefix = resolveLivePrefix(
      payload,
      native,
      sessionPrefix,
      threadPrefix,
    );
    await handleMessage(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      commands,
      livePrefix,
      native,
    );
  });

  platform.on('message_reply', async (payload: Record<string, unknown>) => {
    await warmController.ensureWarm();
    const native =
      payload.native as import('@/engine/types/controller.types.js').NativeContext;
    const threadID = (payload.event as Record<string, unknown>)['threadID'] as
      string | undefined;
    const sessionPrefix = prefixManager.getPrefix(
      native.userId ?? '',
      native.platform,
      native.sessionId ?? '',
    );
    if (threadID) await restoreThreadPrefix(threadID, native);
    const threadPrefix = threadID
      ? prefixManager.getThreadPrefix(threadID)
      : undefined;
    const livePrefix = resolveLivePrefix(
      payload,
      native,
      sessionPrefix,
      threadPrefix,
    );
    await handleMessage(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      commands,
      livePrefix,
      native,
    );
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
    // Discord requires an interaction acknowledgement within 3s; never let a
    // cold cache consume that budget.
    await warmController.ensureWarm(2_500);
    const native =
      payload.native as import('@/engine/types/controller.types.js').NativeContext;
    const threadID = (payload.event as Record<string, unknown>)['threadID'] as
      string | undefined;
    const sessionPrefix = prefixManager.getPrefix(
      native.userId ?? '',
      native.platform,
      native.sessionId ?? '',
    );
    const threadPrefix = threadID
      ? prefixManager.getThreadPrefix(threadID)
      : undefined;
    await handleButtonAction(
      payload.api as UnifiedApi,
      payload.event as Record<string, unknown>,
      commands,
      native,
      // A button click re-runs the owning command (e.g. help's Prev/Next page),
      // so the re-render must keep the same prefix the message used — otherwise
      // every displayed command loses its prefix on the button-action re-render.
      threadPrefix ?? sessionPrefix,
    );
  });

  logger.info('Cat-Bot - starting all platforms...');

  // Connect immediately; the first inbound message awaits `ensureWarm()` at
  // dispatch time (bounded to 8s), so connection setup and cache warm-up overlap
  // instead of adding up.
  platform.start(commands);
  logger.info(
    `Cat-Bot — all platform listeners wired in ${(performance.now() - bootStart).toFixed(0)}ms (cache warm-up continues in background)`,
  );

  // Sync command/event names to the DB for dashboard display — runs in the
  // background so the bot starts accepting messages without waiting for DB writes.
  void syncCommandsAndEvents(commands, eventModules, sessionConfigs).catch(
    (err) =>
      logger.warn('[app] Background syncCommandsAndEvents failed', {
        error: err,
      }),
  );

  // Start the webhook/API server lazily in the background. Loading the server
  // stack (express, better-auth, socket.io) at boot defers the bot's platform
  // listeners behind their module evaluation; starting it asynchronously lets
  // the first message be handled as soon as the platform session is live.
  void import('@/server/server.js')
    .then(({ startServer }) => startServer())
    .catch((err) =>
      logger.error('[app] Failed to start web/API server', { error: err }),
    );

  // Refresh below the 15-min LRU TTL. If the process was suspended/frozen for
  // longer, `ensureWarm()` on the next message refreshes before dispatch — the
  // cache is never trusted past its freshness window. unref() so the timer
  // never keeps the process alive on its own.
  setInterval(
    () => {
      void warmController.warm();
      warmPlatformConnections({
        discord: sessionConfigs.discord.length > 0,
        telegram: sessionConfigs.telegram.length > 0,
      });
    },
    8 * 60 * 1000,
  ).unref();
}

// ── Signal handlers ───────────────────────────────────────────────────────────
// Registered once here so N platform sessions never stack duplicate listeners.

async function handleShutdown(signal: string, exitCode: number): Promise<void> {
  logger.info(
    `🛑 [app] Received ${signal} — stopping all platform sessions...`,
  );
  await sessionManager.stopAll(signal);
  process.exit(exitCode);
}

process.once('SIGINT', () => {
  void handleShutdown('SIGINT', 0);
});
process.once('SIGTERM', () => {
  void handleShutdown('SIGTERM', 0);
});
// NOTE: `on`, not `once` — a one-shot listener silently disarms after the
// first event, and the *second* unhandled rejection then kills the process
// with no log line at all.
process.on('uncaughtException', (err: Error) => {
  logger.error('💀 [app] Uncaught exception — exiting', { error: err });
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  logger.error('💀 [app] Unhandled rejection', { error: reason });
});

main().catch((err: unknown) => {
  logger.error('💀 Fatal: could not start Cat-Bot', { error: err });
  process.exit(1);
});
