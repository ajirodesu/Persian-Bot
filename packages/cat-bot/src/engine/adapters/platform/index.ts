/**
 * Unified Platform Aggregator — Multi-Session Edition
 *
 * createUnifiedPlatformListener() accepts arrays of session configs per platform
 * and creates one listener per session. All sessions from all platforms forward
 * their events to the single returned EventEmitter — app.ts sees one uniform
 * event surface regardless of how many accounts are running per transport.
 *
 * Adding a new account for any platform: add a new numbered session directory and
 * re-start the bot. No code changes required here or in app.ts.
 *
 * Forwarded event types (all payloads: { api: UnifiedApi, event: UnifiedEvent, native }):
 *   'message'          — Discord, Telegram
 *   'message_reply'    — Discord, Telegram
 *   'event'            — Discord, Telegram (join/leave/thread admin)
 *   'message_reaction' — Discord, Telegram
 *   'message_unsend'   — Discord
 *   'button_action'    — Discord, Telegram
 *
 * Retry architecture:
 *   Each platform listener (discord/, telegram/) owns its own exponential-backoff
 *   retry loop inside emitter.start(). This file is a pure orchestrator — it wires
 *   start/stop lifecycle handles but applies NO retry logic of its own. One failing
 *   platform session is fully self-contained and cannot cause zombie behaviour in
 *   the shared orchestrator.
 *
 * Transports that do not support a given type never emit it — no guards needed in app.ts.
 *
 * Persisted vs transient stop:
 *   Every registered stop() accepts (signal?, persist = true). User-initiated
 *   stop/restart/ban paths use the default (persists isRunning=false to the DB).
 *   SessionManager.stopAll() — fired only from the process SIGINT/SIGTERM handler —
 *   passes persist=false so a server restart tears down transports cleanly without
 *   touching the DB flag, letting session-loader auto-resume the session on boot.
 */

import { EventEmitter } from 'events';
import { createLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import type { SessionLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
// NOTE: withRetry and isAuthError are intentionally absent here — each platform listener
// owns its own retry loop so failures are self-contained and predictable.
import {
  Platforms,
  PLATFORM_TO_ID,
} from '@/engine/modules/platform/platform.constants.js';
import { upsertSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { upsertSessionEvents } from '@/engine/modules/session/bot-session-events.repo.js';
import {
  commandRegistry,
  eventRegistry,
} from '@/engine/lib/module-registry.lib.js';

// ── Lazy transport SDK loading ─────────────────────────────────────────────────
// `discord.js` and `grammy` are both sizeable SDKs — importing either one eagerly
// costs real wall-clock time at process boot (discord.js alone is ~500ms of pure
// module-graph loading before it does anything). A deployment running only one
// platform was previously paying that cost for BOTH transports on every cold
// start, restart, and redeploy, since createDiscordListener/createTelegramListener
// were static imports evaluated unconditionally at module load time.
//
// These loaders defer the import until a session for that specific platform is
// actually about to start — either at boot (via createUnifiedPlatformListener,
// gated on config.discord/telegram being non-empty) or later at runtime (via
// spawnDynamicSession, when the dashboard adds a first session for a platform
// that wasn't previously active). Each loader caches its promise so the dynamic
// import only ever executes once per process, regardless of how many sessions
// or spawn calls request it afterwards.
type DiscordModule = typeof import('./discord/index.js');
type TelegramModule = typeof import('./telegram/index.js');

let discordModulePromise: Promise<DiscordModule> | null = null;
function loadDiscordModule(): Promise<DiscordModule> {
  discordModulePromise ??= import('./discord/index.js');
  return discordModulePromise;
}

let telegramModulePromise: Promise<TelegramModule> | null = null;
function loadTelegramModule(): Promise<TelegramModule> {
  telegramModulePromise ??= import('./telegram/index.js');
  return telegramModulePromise;
}

/**
 * Every registered platform ID in one place — derived from each platform's own index.ts constant.
 * Adding a new transport requires only: (1) export PLATFORM_ID from its index.ts and
 * (2) add it to this array. adapters/models/ never needs to change.
 */
export const PLATFORM_IDS = [
  Platforms.Discord,
  Platforms.Telegram,
] as const;

/** Union of all registered platform IDs plus the 'unknown' sentinel for pre-identification contexts. */
export type PlatformId = (typeof PLATFORM_IDS)[number] | 'unknown';

// ── Per-session config shapes — one entry per session directory ───────────────

export interface DiscordConfig {
  token: string;
  clientId: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

export interface TelegramConfig {
  botToken: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

/**
 * Per-platform arrays of session configs.
 * An empty array for any platform means that transport is simply not activated —
 * identical to the previous behaviour when a platform was not configured at all.
 */
interface PlatformConfig {
  discord: DiscordConfig[];
  telegram: TelegramConfig[];
}

type UnifiedPlatformEmitter = EventEmitter & {
  start: (commands: Map<string, Record<string, unknown>>) => Promise<void>;
};

/**
 * All event types forwarded verbatim from each individual transport to the
 * unified emitter. Transports that never emit a given type are transparent no-ops.
 */
const FORWARDED_EVENTS = [
  'message',
  'message_reply',
  'event',
  'message_reaction',
  'message_unsend',
  'button_action',
] as const;

// Retain singletons so external services (like bot.service.ts) can dynamically
// attach new sessions directly to the running application state.
let globalEmitter: UnifiedPlatformEmitter | null = null;
let activeCommands: Map<string, Record<string, unknown>> | null = null;

/**
 * Creates a unified platform listener that aggregates all configured sessions
 * across all configured transport types.
 */
export function createUnifiedPlatformListener(
  config: PlatformConfig,
): UnifiedPlatformEmitter {
  const emitter = new EventEmitter() as UnifiedPlatformEmitter;
  globalEmitter = emitter;

  /**
   * Wires every forwarded event type from one transport instance to the shared
   * unified emitter. Shared between the boot-time path below and spawnDynamicSession.
   */
  function forwardEvents(transport: EventEmitter): void {
    for (const eventType of FORWARDED_EVENTS) {
      transport.on(eventType, (payload: unknown) =>
        emitter.emit(eventType, payload),
      );
    }
  }

  /**
   * Boots all session listeners in parallel.
   * Each platform listener owns its own retry loop — a failing session is self-contained.
   * Errors are caught per-session so one failing account never prevents others from starting.
   *
   * Listener construction (and therefore each transport SDK's dynamic import) happens
   * HERE rather than at createUnifiedPlatformListener() call time — app.ts always wires
   * its `platform.on(...)` handlers before calling `platform.start(...)`, so deferring
   * construction this far is safe: no event can fire before its forwarding listener
   * is attached below. This is what lets a Telegram-only deployment skip loading
   * discord.js entirely, and vice versa.
   */
  emitter.start = async (
    commands: Map<string, Record<string, unknown>>,
  ): Promise<void> => {
    activeCommands = commands;

    // Only pay for discord.js's module graph when at least one Discord session exists.
    if (config.discord.length > 0) {
      const { createDiscordListener } = await loadDiscordModule();
      const discordListeners = config.discord.map((c) =>
        createDiscordListener(c),
      );
      discordListeners.forEach((l, i) => {
        forwardEvents(l);
        const c = config.discord[i]!;
        const smKey = `${c.userId}:${Platforms.Discord}:${c.sessionId}`;
        const sessionLogger = createLogger({
          userId: c.userId,
          platformId: PLATFORM_TO_ID[Platforms.Discord],
          sessionId: c.sessionId,
        });
        const stopFn = async (signal?: string, persist = true) => {
          if (persist) {
            await sessionManager.markInactive(smKey);
          } else {
            sessionManager.markInactiveTransient(smKey);
          }
          await l.stop(signal);
        };
        sessionManager.register(smKey, {
          start: () => l.start(commands),
          stop: stopFn,
        });
        void sessionManager
          .start(smKey)
          .catch((err) =>
            sessionLogger.error(`[discord] Fatal startup error:`, {
              error: err,
            }),
          );
      });
    }

    // Only pay for grammy's module graph when at least one Telegram session exists.
    if (config.telegram.length > 0) {
      const { createTelegramListener } = await loadTelegramModule();
      const telegramListeners = config.telegram.map((c) =>
        createTelegramListener(c),
      );
      telegramListeners.forEach((l, i) => {
        forwardEvents(l);
        const c = config.telegram[i]!;
        const smKey = `${c.userId}:${Platforms.Telegram}:${c.sessionId}`;
        const sessionLogger = createLogger({
          userId: c.userId,
          platformId: PLATFORM_TO_ID[Platforms.Telegram],
          sessionId: c.sessionId,
        });
        const stopFn = async (signal?: string, persist = true) => {
          if (persist) {
            await sessionManager.markInactive(smKey);
          } else {
            sessionManager.markInactiveTransient(smKey);
          }
          await l.stop(signal);
        };
        sessionManager.register(smKey, {
          start: () => l.start(commands),
          stop: stopFn,
        });
        void sessionManager.start(smKey).catch((err) =>
          sessionLogger.error(`[telegram] Fatal startup error:`, {
            error: err,
          }),
        );
      });
    }
  };

  return emitter;
}

/**
 * Dynamically spawns a new session onto the live platform orchestrator without
 * restarting the process. Used exclusively by the web dashboard integration.
 *
 * Retry is owned by each platform listener — this function simply creates the
 * listener, wires its events to the global emitter, and registers its lifecycle.
 */
export async function spawnDynamicSession(
  platform: string,
  sessionConfig: DiscordConfig | TelegramConfig,
): Promise<void> {
  if (!globalEmitter || !activeCommands) {
    // Application orchestrator has not booted yet (e.g. testing context or pre-init API call).
    return;
  }

  // 1. Sync modules to the DB immediately so the web dashboard's "Commands" and "Events"
  //    tabs populate without requiring a complete process restart.
  const commandNames = Array.from(commandRegistry.keys());
  const eventNames = Array.from(eventRegistry.keys());

  await upsertSessionCommands(
    sessionConfig.userId,
    platform,
    sessionConfig.sessionId,
    commandNames,
  );
  await upsertSessionEvents(
    sessionConfig.userId,
    platform,
    sessionConfig.sessionId,
    eventNames,
  );

  // Generic EventEmitter for wiring up to the unified event pipeline
  let listener: EventEmitter;
  let smKey = '';
  let startFn: () => Promise<void>;
  let stopFn: (signal?: string, persist?: boolean) => Promise<void>;
  let sessionLogger: SessionLogger;

  if (platform === Platforms.Discord) {
    const { createDiscordListener } = await loadDiscordModule();
    const l = createDiscordListener(sessionConfig as DiscordConfig);
    listener = l;
    smKey = `${sessionConfig.userId}:${Platforms.Discord}:${sessionConfig.sessionId}`;
    sessionLogger = createLogger({
      userId: sessionConfig.userId,
      platformId: PLATFORM_TO_ID[Platforms.Discord],
      sessionId: sessionConfig.sessionId,
    });
    // Retry is inside l.start() — wire directly.
    startFn = () => l.start(activeCommands!);
    stopFn = async (signal?: string, persist = true) => {
      if (persist) {
        await sessionManager.markInactive(smKey);
      } else {
        sessionManager.markInactiveTransient(smKey);
      }
      await l.stop(signal);
    };
  } else if (platform === Platforms.Telegram) {
    const { createTelegramListener } = await loadTelegramModule();
    const l = createTelegramListener(sessionConfig as TelegramConfig);
    listener = l;
    smKey = `${sessionConfig.userId}:${Platforms.Telegram}:${sessionConfig.sessionId}`;
    sessionLogger = createLogger({
      userId: sessionConfig.userId,
      platformId: PLATFORM_TO_ID[Platforms.Telegram],
      sessionId: sessionConfig.sessionId,
    });
    startFn = () => l.start(activeCommands!);
    stopFn = async (signal?: string, persist = true) => {
      if (persist) {
        await sessionManager.markInactive(smKey);
      } else {
        sessionManager.markInactiveTransient(smKey);
      }
      await l.stop(signal);
    };
  } else {
    throw new Error(`[spawnDynamicSession] Unsupported platform: ${platform}`);
  }

  // 2. Wire the dedicated listener into the unified global emitter pipeline
  for (const eventType of FORWARDED_EVENTS) {
    listener.on(eventType, (payload: unknown) =>
      globalEmitter!.emit(eventType, payload),
    );
  }

  // 3. Register lifecycle — retry is owned by each platform listener
  sessionManager.register(smKey, {
    start: startFn,
    stop: stopFn,
  });

  // 4. Boot the session transport (retry loop runs inside the listener)
  void sessionManager.start(smKey).catch((err) => {
    sessionLogger.error(`[${platform}] Fatal startup error:`, { error: err });
  });
}
