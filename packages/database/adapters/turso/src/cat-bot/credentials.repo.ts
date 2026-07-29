import { tursoClient, intToBool } from '../client.js';
import {
  Platforms,
  PLATFORM_TO_ID,
} from '@cat-bot/engine/modules/platform/platform.constants.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';
import { decrypt } from '@cat-bot/engine/utils/crypto.util.js';

// ── Discord ───────────────────────────────────────────────────────────────────

export async function findDiscordCredentialState(
  userId: string,
  sessionId: string,
): Promise<{ isCommandRegister: boolean; commandHash: string | null } | null> {
  const res = await tursoClient.execute({
    sql: `SELECT is_command_register, command_hash FROM bot_credential_discord
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId`,
    args: {
      userId,
      platformId: PLATFORM_TO_ID[Platforms.Discord],
      sessionId,
    },
  });
  const row = res.rows[0] as
    | { is_command_register: number; command_hash: string | null }
    | undefined;
  if (!row) return null;
  return {
    isCommandRegister: intToBool(row.is_command_register),
    commandHash: row.command_hash,
  };
}

export async function updateDiscordCredentialCommandHash(
  userId: string,
  sessionId: string,
  data: { isCommandRegister: boolean; commandHash: string },
): Promise<void> {
  // UPDATE throws implicitly on missing row via rowsAffected check.
  const res = await tursoClient.execute({
    sql: `UPDATE bot_credential_discord
          SET is_command_register = :isCommandRegister, command_hash = :commandHash
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId`,
    args: {
      userId,
      platformId: PLATFORM_TO_ID[Platforms.Discord],
      sessionId,
      isCommandRegister: data.isCommandRegister ? 1 : 0,
      commandHash: data.commandHash,
    },
  });
  if (res.rowsAffected === 0) throw new Error('Credential record not found');
}

export async function findAllDiscordCredentials(): Promise<
  Record<string, unknown>[]
> {
  const res = await tursoClient.execute(
    `SELECT user_id, platform_id, session_id, discord_token, discord_client_id,
            is_command_register, command_hash
     FROM bot_credential_discord`,
  );
  return (
    res.rows as unknown as Array<{
      user_id: string;
      platform_id: number;
      session_id: string;
      discord_token: string;
      discord_client_id: string;
      is_command_register: number;
      command_hash: string | null;
    }>
  ).map((r) => ({
    userId: r.user_id,
    platformId: r.platform_id,
    sessionId: r.session_id,
    discordToken: decrypt(r.discord_token),
    discordClientId: r.discord_client_id,
    isCommandRegister: intToBool(r.is_command_register),
    commandHash: r.command_hash,
  }));
}

// ── Telegram ──────────────────────────────────────────────────────────────────

export async function findTelegramCredentialState(
  userId: string,
  sessionId: string,
): Promise<{ isCommandRegister: boolean; commandHash: string | null } | null> {
  const res = await tursoClient.execute({
    sql: `SELECT is_command_register, command_hash FROM bot_credential_telegram
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId`,
    args: {
      userId,
      platformId: PLATFORM_TO_ID[Platforms.Telegram],
      sessionId,
    },
  });
  const row = res.rows[0] as
    | { is_command_register: number; command_hash: string | null }
    | undefined;
  if (!row) return null;
  return {
    isCommandRegister: intToBool(row.is_command_register),
    commandHash: row.command_hash,
  };
}

export async function updateTelegramCredentialCommandHash(
  userId: string,
  sessionId: string,
  data: { isCommandRegister: boolean; commandHash: string },
): Promise<void> {
  const res = await tursoClient.execute({
    sql: `UPDATE bot_credential_telegram
          SET is_command_register = :isCommandRegister, command_hash = :commandHash
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId`,
    args: {
      userId,
      platformId: PLATFORM_TO_ID[Platforms.Telegram],
      sessionId,
      isCommandRegister: data.isCommandRegister ? 1 : 0,
      commandHash: data.commandHash,
    },
  });
  if (res.rowsAffected === 0) throw new Error('Credential record not found');
}

export async function findAllTelegramCredentials(): Promise<
  Record<string, unknown>[]
> {
  const res = await tursoClient.execute(
    `SELECT user_id, platform_id, session_id, telegram_token, is_command_register, command_hash
     FROM bot_credential_telegram`,
  );
  return (
    res.rows as unknown as Array<{
      user_id: string;
      platform_id: number;
      session_id: string;
      telegram_token: string;
      is_command_register: number;
      command_hash: string | null;
    }>
  ).map((r) => ({
    userId: r.user_id,
    platformId: r.platform_id,
    sessionId: r.session_id,
    telegramToken: decrypt(r.telegram_token),
    isCommandRegister: intToBool(r.is_command_register),
    commandHash: r.command_hash,
  }));
}

// ── Bot Sessions ──────────────────────────────────────────────────────────────

export async function findAllBotSessions(): Promise<Record<string, unknown>[]> {
  const res = await tursoClient.execute(
    `SELECT user_id, platform_id, session_id, nickname, prefix, is_running
     FROM bot_session`,
  );
  return (
    res.rows as unknown as Array<{
      user_id: string;
      platform_id: number;
      session_id: string;
      nickname: string | null;
      prefix: string | null;
      is_running: number;
    }>
  ).map((r) => ({
    userId: r.user_id,
    platformId: r.platform_id,
    sessionId: r.session_id,
    nickname: r.nickname,
    prefix: r.prefix,
    isRunning: intToBool(r.is_running),
  }));
}

// ── Bot Admin ─────────────────────────────────────────────────────────────────

export async function isBotAdmin(
  userId: string,
  platform: string,
  sessionId: string,
  adminId: string,
): Promise<boolean> {
  const platformId = toPlatformNumericId(platform);
  const res = await tursoClient.execute({
    sql: `SELECT 1 FROM bot_admin
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND admin_id = :adminId`,
    args: { userId, platformId, sessionId, adminId },
  });
  return (res.rows.length ?? 0) > 0;
}

export async function addBotAdmin(
  userId: string,
  platform: string,
  sessionId: string,
  adminId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // ON CONFLICT DO NOTHING makes the insert idempotent: a duplicate admin insert
  // silently no-ops without error, avoiding the overhead of an UPDATE that writes nothing.
  await tursoClient.execute({
    sql: `INSERT INTO bot_admin (user_id, platform_id, session_id, admin_id)
          VALUES (:userId, :platformId, :sessionId, :adminId)
          ON CONFLICT (user_id, platform_id, session_id, admin_id) DO NOTHING`,
    args: { userId, platformId, sessionId, adminId },
  });
}

export async function removeBotAdmin(
  userId: string,
  platform: string,
  sessionId: string,
  adminId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // DELETE with no row = silent no-op, matching deleteMany fail-safe contract.
  await tursoClient.execute({
    sql: `DELETE FROM bot_admin
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND admin_id = :adminId`,
    args: { userId, platformId, sessionId, adminId },
  });
}

export async function listBotAdmins(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const platformId = toPlatformNumericId(platform);
  const res = await tursoClient.execute({
    sql: `SELECT admin_id FROM bot_admin
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId
          ORDER BY admin_id`,
    args: { userId, platformId, sessionId },
  });
  return (res.rows as unknown as Array<{ admin_id: string }>).map(
    (r) => r.admin_id,
  );
}

/**
 * Persists a system prefix change so the admin's choice survives a process restart.
 * UPDATE with no matching row is a silent no-op — same fail-open contract as updateMany.
 */
export async function updateBotSessionPrefix(
  userId: string,
  platform: string,
  sessionId: string,
  prefix: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await tursoClient.execute({
    sql: `UPDATE bot_session SET prefix = :prefix
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId`,
    args: { userId, platformId, sessionId, prefix },
  });
}

/**
 * Reads the bot's configured display name from bot_session.
 * Returns null when the session row is absent or nickname was never set.
 */
export async function getBotNickname(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string | null> {
  const platformId = toPlatformNumericId(platform);
  const res = await tursoClient.execute({
    sql: `SELECT nickname FROM bot_session
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId LIMIT 1`,
    args: { userId, platformId, sessionId },
  });
  const row = res.rows[0] as { nickname: string | null } | undefined;
  return row?.nickname ?? null;
}

// ── Bot Premium ───────────────────────────────────────────────────────────────

export async function isBotPremium(
  userId: string,
  platform: string,
  sessionId: string,
  premiumId: string,
): Promise<boolean> {
  const platformId = toPlatformNumericId(platform);
  const res = await tursoClient.execute({
    sql: `SELECT 1 FROM bot_premium
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND premium_id = :premiumId`,
    args: { userId, platformId, sessionId, premiumId },
  });
  return (res.rows.length ?? 0) > 0;
}

export async function addBotPremium(
  userId: string,
  platform: string,
  sessionId: string,
  premiumId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // ON CONFLICT DO NOTHING keeps this idempotent when the same premiumId is added
  // twice; no error on duplicate insert.
  await tursoClient.execute({
    sql: `INSERT INTO bot_premium (user_id, platform_id, session_id, premium_id)
          VALUES (:userId, :platformId, :sessionId, :premiumId)
          ON CONFLICT (user_id, platform_id, session_id, premium_id) DO NOTHING`,
    args: { userId, platformId, sessionId, premiumId },
  });
}

export async function removeBotPremium(
  userId: string,
  platform: string,
  sessionId: string,
  premiumId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // DELETE with no matching row is a silent no-op — same fail-open contract as admin.
  await tursoClient.execute({
    sql: `DELETE FROM bot_premium
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND premium_id = :premiumId`,
    args: { userId, platformId, sessionId, premiumId },
  });
}

export async function listBotPremiums(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const platformId = toPlatformNumericId(platform);
  const res = await tursoClient.execute({
    sql: `SELECT premium_id FROM bot_premium
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId
          ORDER BY premium_id`,
    args: { userId, platformId, sessionId },
  });
  return (res.rows as unknown as Array<{ premium_id: string }>).map(
    (r) => r.premium_id,
  );
}

/**
 * Reads the JSON data blob from bot_session.
 * Returns empty object on missing record, null data, or parse failure.
 */
export async function getBotSessionData(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const platformId = toPlatformNumericId(platform);
  const res = await tursoClient.execute({
    sql: `SELECT data FROM bot_session
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId LIMIT 1`,
    args: { userId, platformId, sessionId },
  });
  const row = res.rows[0] as { data: string | null } | undefined;
  if (!row?.data) return {};
  try {
    return JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function setBotSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await tursoClient.execute({
    sql: `UPDATE bot_session SET data = :data
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId`,
    args: { userId, platformId, sessionId, data: JSON.stringify(data) },
  });
}
