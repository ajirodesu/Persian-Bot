/**
 * Session Credential Loader — Database Edition
 *
 * Loads all platform session credentials directly from the database using Prisma.
 * Each credential table row becomes one resolved session config.
 *
 * Prefix is resolved from BotSession for each (userId, platformId, sessionId) tuple;
 * defaults to '/' when no BotSession row exists for that session.
 *
 * Replaces the file-based loader that read session/{userId}/{platform}/{sessionId}/ directories.
 * Sessions are now managed entirely through the database — no credential JSON files required.
 */

import {
  findAllDiscordCredentials,
  findAllTelegramCredentials,
  findAllBotSessions,
} from '@/engine/repos/credentials.repo.js';
import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { prefixManager } from '@/engine/modules/prefix/prefix-manager.lib.js';
import { fromPlatformNumericId } from '@/engine/modules/platform/platform-id.util.js';

// ── Resolved config shapes (exported for consumers) ───────────────────────────

/** Resolved Discord session config — one entry per BotCredentialDiscord row. */
export interface ResolvedDiscordConfig {
  token: string;
  clientId: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

/** Resolved Telegram session config — one entry per BotCredentialTelegram row. */
export interface ResolvedTelegramConfig {
  botToken: string;
  prefix: string;
  userId: string;
  sessionId: string;
}

/** Fully-resolved configuration for all platforms, consumed by app.ts. */
export interface SessionConfigs {
  discord: ResolvedDiscordConfig[];
  telegram: ResolvedTelegramConfig[];
}

/**
 * Loads all platform credentials from the database and resolves each into a typed config.
 *
 * All tables (credential + BotIdentity) are fetched in parallel to minimise
 * total round-trip time. The session prefix lookup is built into an in-memory Map
 * keyed by `userId:platformId:sessionId` — one DB query total, O(1) per credential lookup.
 *
 * Platforms with no credential rows return empty arrays and are silently skipped
 * by the platform listener layer — identical behaviour to the previous file-based loader
 * when a platform directory was absent.
 */
export async function loadSessionConfigs(): Promise<SessionConfigs> {
  const [
    discordCreds,
    telegramCreds,
    botSessions,
  ] = await Promise.all([
    findAllDiscordCredentials(),
    findAllTelegramCredentials(),
    findAllBotSessions(),
  ]);

  // Sync all loaded prefixes into the dynamic PrefixManager.
  // Track which sessions have isRunning !== false — built in the same pass to avoid a second query.
  // isRunning defaults to true in the schema; a missing BotSession row is treated as running (fail-open).
  const runningKeys = new Set<string>();
  for (const session of botSessions) {
    try {
      const platformStr = fromPlatformNumericId(session.platformId);
      prefixManager.setPrefix(
        session.userId,
        platformStr,
        session.sessionId,
        session.prefix ?? '/',
      );
    } catch {
      // Ignore unknown platform IDs gracefully
    }
    const sessionKey = `${session.userId}:${session.platformId}:${session.sessionId}`;
    if (session.isRunning !== false) runningKeys.add(sessionKey);
  }

  function getPrefix(
    userId: string,
    platformId: number,
    sessionId: string,
  ): string {
    try {
      const platformStr = fromPlatformNumericId(platformId);
      return prefixManager.getPrefix(userId, platformStr, sessionId);
    } catch {
      return '/';
    }
  }

  // isRunning = false sessions are excluded so a stopped bot never boots at process start or restart.
  const discord: ResolvedDiscordConfig[] = discordCreds
    .filter(
      (c: {
        userId: string;
        platformId: number;
        sessionId: string;
        discordToken: string;
        discordClientId: string;
      }) => runningKeys.has(`${c.userId}:${c.platformId}:${c.sessionId}`),
    )
    .map(
      (c: {
        userId: string;
        platformId: number;
        sessionId: string;
        discordToken: string;
        discordClientId: string;
      }) => ({
        token: c.discordToken,
        clientId: c.discordClientId,
        prefix: getPrefix(c.userId, c.platformId, c.sessionId),
        userId: c.userId,
        sessionId: c.sessionId,
      }),
    );

  const telegram: ResolvedTelegramConfig[] = telegramCreds
    .filter(
      (c: {
        userId: string;
        platformId: number;
        sessionId: string;
        telegramToken: string;
      }) => runningKeys.has(`${c.userId}:${c.platformId}:${c.sessionId}`),
    )
    .map(
      (c: {
        userId: string;
        platformId: number;
        sessionId: string;
        telegramToken: string;
      }) => ({
        botToken: c.telegramToken,
        prefix: getPrefix(c.userId, c.platformId, c.sessionId),
        userId: c.userId,
        sessionId: c.sessionId,
      }),
    );

  logger.info(
    `[session-loader] Loaded from DB — Discord: ${discord.length}, Telegram: ${telegram.length}`,
  );

  return { discord, telegram };
}
