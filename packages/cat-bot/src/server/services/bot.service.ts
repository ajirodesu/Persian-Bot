import { randomUUID } from 'node:crypto';
import axios from 'axios';
import { botRepo } from '@/server/repos/bot.repo.js';
import { spawnDynamicSession } from '@/engine/adapters/platform/index.js';
import { sessionManager } from '@/engine/modules/session/session-manager.lib.js';
import { logger, createLogger } from '@/engine/modules/logger/logger.lib.js';
import { prefixManager } from '@/engine/modules/prefix/prefix-manager.lib.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';
import { triggerSlashSync } from '@/engine/modules/prefix/slash-sync.lib.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { withRetry, isNetworkError, isAuthError } from '@/engine/lib/retry.lib.js';
import { TTLMap } from '@/engine/lib/ttl-map.lib.js';
import type {
  CreateBotRequestDto,
  CreateBotResponseDto,
  GetBotListResponseDto,
  GetBotDetailResponseDto,
  UpdateBotRequestDto,
} from '@/server/dtos/bot.dto.js';

/** Thrown when a start/stop/restart action is blocked by cooldown or session lock (→ HTTP 423). */
export class BusyError extends Error {
  readonly action: string;
  constructor(action: string) {
    super(`${action} is busy`);
    this.action = action;
    this.name = 'BusyError';
  }
}

// Per-session 3-second cooldown prevents zombie listener accumulation from rapid clicks.
const ACTION_COOLDOWN_MS = 3_000;
const actionCooldowns = new TTLMap<string>({
  ttlMs: ACTION_COOLDOWN_MS,
  sliding: false, // must NOT extend on read — that would reset the penalty clock on retry
  cleanupIntervalMs: 60_000,
});

const RESTART_COOLDOWN_MS = 3_000;
const restartCooldowns = new TTLMap<string>({
  ttlMs: RESTART_COOLDOWN_MS,
  sliding: false,
  cleanupIntervalMs: 60_000,
});

function getActiveSessionCooldownAction(userId: string, sessionId: string): string | undefined {
  return actionCooldowns.get(`${userId}:${sessionId}`);
}
function setSessionCooldown(userId: string, sessionId: string, action: string): void {
  actionCooldowns.set(`${userId}:${sessionId}`, action);
}
function getActiveRestartCooldownAction(userId: string, sessionId: string): string | undefined {
  return restartCooldowns.get(`${userId}:${sessionId}`);
}
function setRestartCooldown(userId: string, sessionId: string, action: string): void {
  restartCooldowns.set(`${userId}:${sessionId}`, action);
}

// GET /users/@me with a Bot token returns the bot user whose `id` equals the Application ID.
async function fetchDiscordClientId(discordToken: string): Promise<string> {
  const response = await withRetry(
    () => axios.get<{ id: string }>('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${discordToken}` },
    }),
    {
      maxAttempts: 3,
      initialDelayMs: 1000,
      shouldRetry: (err) => !isAuthError(err) && isNetworkError(err),
    },
  );
  return response.data.id;
}

class BotService {
  async createBot(userId: string, dto: CreateBotRequestDto): Promise<CreateBotResponseDto> {
    const sessionId = randomUUID();
    const credentials = dto.credentials.platform === 'discord'
      ? { ...dto.credentials, discordClientId: await fetchDiscordClientId(dto.credentials.discordToken) }
      : dto.credentials;

    const result = await botRepo.create(userId, sessionId, { ...dto, credentials });
    const platformStr = credentials.platform;

    let sessionConfig: Parameters<typeof spawnDynamicSession>[1] | undefined;
    if (platformStr === Platforms.Discord && 'discordToken' in credentials) {
      sessionConfig = { token: credentials.discordToken, clientId: credentials.discordClientId, prefix: dto.botPrefix, userId, sessionId };
    } else if (platformStr === Platforms.Telegram && 'telegramToken' in credentials) {
      sessionConfig = { botToken: credentials.telegramToken, prefix: dto.botPrefix, userId, sessionId };
    } else if (platformStr === Platforms.Fluxer && 'fluxerToken' in credentials) {
      sessionConfig = { token: credentials.fluxerToken, prefix: dto.botPrefix, userId, sessionId };
    }

    prefixManager.setPrefix(userId, platformStr, sessionId, dto.botPrefix);
    if (sessionConfig) {
      spawnDynamicSession(platformStr, sessionConfig).catch((err) => {
        console.error('[bot.service] Failed to spawn dynamic session:', err);
      });
    }
    return result;
  }

  async getBot(userId: string, sessionId: string): Promise<GetBotDetailResponseDto | null> {
    return botRepo.getById(userId, sessionId);
  }

  async updateBot(userId: string, sessionId: string, dto: UpdateBotRequestDto): Promise<void> {
    const botDetail = await botRepo.getById(userId, sessionId);
    const credentials = dto.credentials.platform === 'discord'
      ? { ...dto.credentials, discordClientId: await fetchDiscordClientId(dto.credentials.discordToken) }
      : dto.credentials;

    const isCredentialsModified = (() => {
      if (!botDetail) return true;
      if (botDetail.credentials.platform === Platforms.Discord && credentials.platform === Platforms.Discord) {
        return botDetail.credentials.discordToken !== credentials.discordToken ||
          botDetail.credentials.discordClientId !== credentials.discordClientId;
      }
      if (botDetail.credentials.platform === Platforms.Telegram && credentials.platform === Platforms.Telegram) {
        return botDetail.credentials.telegramToken !== credentials.telegramToken;
      }
      if (botDetail.credentials.platform === Platforms.Fluxer && credentials.platform === Platforms.Fluxer) {
        return botDetail.credentials.fluxerToken !== credentials.fluxerToken;
      }
      return true;
    })();

    await botRepo.update(userId, sessionId, { ...dto, credentials }, isCredentialsModified);

    const platformStr = dto.credentials.platform;
    prefixManager.setPrefix(userId, platformStr, sessionId, dto.botPrefix);

    const key = `${userId}:${platformStr}:${sessionId}`;
    const isActive = sessionManager.isActive(key);
    const isCurrentlyRetrying = sessionManager.isRetrying(key);

    if (!isCredentialsModified) {
      triggerSlashSync(key).catch((err) => {
        logger.warn('[bot.service] Slash sync trigger failed on prefix update', { error: err });
      });
      if (!isActive && !isCurrentlyRetrying) await sessionManager.unregister(key);
    } else {
      if (isActive || isCurrentlyRetrying) {
        sessionManager.abortRetry(key);
        // Wait for any in-progress boot to release its lock before restarting.
        void sessionManager.waitForUnlock(key, 15_000)
          .then(() => this.restartBot(userId, sessionId))
          .catch((err) => {
            logger.error('[bot.service] Auto-restart on credential update failed (non-fatal)', { error: err });
          });
      } else {
        await sessionManager.unregister(key);
      }
    }
  }

  async listBots(userId: string): Promise<GetBotListResponseDto> {
    return botRepo.list(userId);
  }

  /**
   * Sets isRunning = true in the DB then boots the transport.
   * Prefers the registered SessionManager lifecycle; falls back to spawnDynamicSession
   * when the session was never registered or the process restarted.
   */
  async startBot(userId: string, sessionId: string, bypassCooldown = false): Promise<void> {
    const botDetail = await botRepo.getById(userId, sessionId);
    if (!botDetail) throw new Error(`Bot session ${sessionId} not found`);

    if (!bypassCooldown) {
      const activeAction = getActiveSessionCooldownAction(userId, sessionId);
      if (activeAction) {
        createLogger({ userId, platformId: botDetail.platformId, sessionId })
          .warn(`[bot.service] start is busy — ${activeAction} in progress`);
        throw new BusyError('start');
      }
      setSessionCooldown(userId, sessionId, 'start');
    }

    const key = `${userId}:${botDetail.platform}:${sessionId}`;
    if (sessionManager.isActive(key)) return;
    sessionManager.abortRetry(key);
    if (sessionManager.isLocked(key)) {
      createLogger({ userId, platformId: botDetail.platformId, sessionId }).warn('[bot.service] start is busy');
      throw new BusyError('start');
    }

    await botRepo.updateIsRunning(userId, sessionId, true);

    try {
      await sessionManager.start(key);
      return;
    } catch { /* not registered — fall through to fresh spawn */ }

    const { credentials, prefix } = botDetail;
    let sessionConfig: Parameters<typeof spawnDynamicSession>[1] | undefined;

    if (credentials.platform === Platforms.Discord) {
      sessionConfig = { token: credentials.discordToken, clientId: credentials.discordClientId ?? '', prefix, userId, sessionId };
    } else if (credentials.platform === Platforms.Telegram) {
      sessionConfig = { botToken: credentials.telegramToken, prefix, userId, sessionId };
    } else if (credentials.platform === Platforms.Fluxer) {
      sessionConfig = { token: credentials.fluxerToken, prefix, userId, sessionId };
    }

    if (!sessionConfig) {
      logger.error('[bot.service] No session config built — unrecognised platform', { platform: botDetail.platform });
      return;
    }
    spawnDynamicSession(botDetail.platform, sessionConfig).catch((err: unknown) => {
      logger.error('[bot.service] Failed to spawn session on startBot', { error: err });
    });
  }

  /** Sets isRunning = false in the DB then tears down the live transport. */
  async stopBot(userId: string, sessionId: string): Promise<void> {
    const botDetail = await botRepo.getById(userId, sessionId);
    if (!botDetail) throw new Error(`Bot session ${sessionId} not found`);

    const activeAction = getActiveSessionCooldownAction(userId, sessionId);
    if (activeAction) {
      createLogger({ userId, platformId: botDetail.platformId, sessionId })
        .warn(`[bot.service] stop is busy — ${activeAction} in progress`);
      throw new BusyError('stop');
    }
    setSessionCooldown(userId, sessionId, 'stop');

    const key = `${userId}:${botDetail.platform}:${sessionId}`;
    const slog = createLogger({ userId, platformId: botDetail.platformId, sessionId });

    // Stop is blocked during retry — only Start may cancel the back-off loop.
    if (sessionManager.isRetrying(key)) {
      slog.warn('[bot.service] stop is busy — session is in retry state, use Start to abort');
      throw new BusyError('stop');
    }
    if (sessionManager.isLocked(key)) {
      slog.warn('[bot.service] stop is busy');
      throw new BusyError('stop');
    }

    await botRepo.updateIsRunning(userId, sessionId, false);
    try {
      await sessionManager.stop(key);
    } catch {
      logger.warn(`[bot.service] stopBot: session ${key} not found in manager (already stopped)`);
    }
  }

  /** Restarts the live transport without touching isRunning. */
  async restartBot(userId: string, sessionId: string): Promise<void> {
    const botDetail = await botRepo.getById(userId, sessionId);
    if (!botDetail) throw new Error(`Bot session ${sessionId} not found`);

    const activeRestart = getActiveRestartCooldownAction(userId, sessionId);
    if (activeRestart) {
      createLogger({ userId, platformId: botDetail.platformId, sessionId })
        .warn(`[bot.service] restart is busy — ${activeRestart} in progress`);
      throw new BusyError('restart');
    }
    setRestartCooldown(userId, sessionId, 'restart');

    const key = `${userId}:${botDetail.platform}:${sessionId}`;
    const slog = createLogger({ userId, platformId: botDetail.platformId, sessionId });

    // Restart blocked during retry — only Start can cancel the back-off loop safely.
    if (sessionManager.isRetrying(key)) {
      slog.warn('[bot.service] restart is busy — session is in retry state, use Start to abort');
      throw new BusyError('restart');
    }
    if (sessionManager.isLocked(key)) {
      slog.warn('[bot.service] restart is busy');
      throw new BusyError('restart');
    }

    if (sessionManager.isActive(key)) {
      try {
        await sessionManager.stop(key);
      } catch (e) {
        logger.warn(`[bot.service] restartBot: failed to stop ${key}`, { error: e });
      }
    }
    await sessionManager.unregister(key);
    await this.startBot(userId, sessionId, true);
  }

  /**
   * Permanently destroys a bot session: stops transport, unregisters closure, wipes DB rows.
   * More aggressive than stopBot — no undo path.
   */
  async deleteBot(userId: string, sessionId: string): Promise<void> {
    const botDetail = await botRepo.getById(userId, sessionId);
    if (!botDetail) throw new Error(`Bot session ${sessionId} not found`);

    const key = `${userId}:${botDetail.platform}:${sessionId}`;
    if (sessionManager.isLocked(key)) throw new Error(`Session is locked processing another action.`);

    if (sessionManager.isActive(key)) {
      try {
        await sessionManager.stop(key);
      } catch (e) {
        logger.warn(`[bot.service] deleteBot: failed to stop ${key}`, { error: e });
      }
    }
    await sessionManager.unregister(key);
    await botRepo.deleteById(userId, sessionId);
    logger.info(`[bot.service] Deleted bot session ${key}`);
  }

  /**
   * Ban-path: stops all transports for a user, sets isRunning=false, clears caches.
   * Order: stop transports → update DB → unregister closures → clear LRU → clear prefixes.
   */
  async stopAllUserSessions(userId: string): Promise<void> {
    const { bots } = await botRepo.list(userId);
    if (bots.length === 0) return;

    await sessionManager.stopAllByUserId(userId);
    await Promise.all(
      bots.map((bot) =>
        botRepo.updateIsRunning(userId, bot.sessionId, false).catch((err) =>
          logger.error(`[bot.service] Failed to set isRunning=false for ${bot.sessionId} on ban`, { error: err }),
        ),
      ),
    );
    await sessionManager.unregisterAllByUserId(userId);
    botRepo.clearUserCache(userId);
    prefixManager.clearAllByUserId(userId);
    logger.info(`[bot.service] Stopped ${bots.length} session(s) for banned user ${userId}`);
  }

  /** Unban-path: sets isRunning=true and boots a fresh transport for every user session. */
  async startAllUserSessions(userId: string): Promise<void> {
    const { bots } = await botRepo.list(userId);
    if (bots.length === 0) return;

    await Promise.all(
      bots.map(async (bot) => {
        try {
          await this.startBot(userId, bot.sessionId);
        } catch (err) {
          logger.error(`[bot.service] Failed to start session ${bot.sessionId} on unban`, { error: err });
        }
      }),
    );
    logger.info(`[bot.service] Started ${bots.length} session(s) for unbanned user ${userId}`);
  }

  /**
   * Reset-all-database: stops every transport not owned by excludeUserId, then clears
   * all caches. Must run BEFORE the database wipe so no in-flight event writes through
   * stale credentials for sessions whose rows are about to disappear.
   */
  async stopAllSessionsExcept(excludeUserId: string): Promise<void> {
    await sessionManager.stopAllExcludingUserId(excludeUserId);
    await sessionManager.unregisterAllExcludingUserId(excludeUserId);
    lruCache.clear();
    prefixManager.clearAll();
    logger.info(`[bot.service] Stopped all bot sessions except user ${excludeUserId} ahead of database reset`);
  }
}

export const botService = new BotService();
