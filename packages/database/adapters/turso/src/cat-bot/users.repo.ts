import { tursoClient } from '../client.js';
import type { BotUserData } from '@cat-bot/engine/models/users.model.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertUser(data: BotUserData): Promise<void> {
  await tursoClient.execute({
    sql: `INSERT INTO bot_users (platform_id, id, name, first_name, username, avatar_url, updated_at)
          VALUES (:platformId, :id, :name, :firstName, :username, :avatarUrl, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT (id) DO UPDATE SET
            name = excluded.name,
            first_name = excluded.first_name,
            username = excluded.username,
            -- avatar_url intentionally omitted to preserve high-res avatars
            updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    args: {
      platformId: data.platformId,
      id: data.id,
      name: data.name,
      firstName: data.firstName ?? null,
      username: data.username ?? null,
      avatarUrl: data.avatarUrl ?? null,
    },
  });
}

export async function userExists(
  platform: string,
  userId: string,
): Promise<boolean> {
  const res = await tursoClient.execute({
    sql: `SELECT 1 FROM bot_users WHERE id = :userId`,
    args: { userId },
  });
  return res.rows.length > 0;
}

export async function userSessionExists(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<boolean> {
  const platformId = toPlatformNumericId(platform);
  const res = await tursoClient.execute({
    sql: `SELECT 1 FROM bot_users_session
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND bot_user_id = :botUserId`,
    args: { userId, platformId, sessionId, botUserId },
  });
  return res.rows.length > 0;
}

export async function upsertUserSession(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // Explicit last_updated_at refresh on conflict ensures the timestamp is always
  // updated, since raw SQL has no auto-updated-timestamp column behavior.
  await tursoClient.execute({
    sql: `INSERT INTO bot_users_session (user_id, platform_id, session_id, bot_user_id, last_updated_at)
          VALUES (:userId, :platformId, :sessionId, :botUserId, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT (user_id, platform_id, session_id, bot_user_id)
          DO UPDATE SET last_updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    args: { userId, platformId, sessionId, botUserId },
  });
}

/**
 * Returns the lastUpdatedAt timestamp for staleness checks. Returns null when no row exists,
 * signalling middleware that a full user sync is required on the next message.
 */
export async function getUserSessionUpdatedAt(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<Date | null> {
  const platformId = toPlatformNumericId(platform);
  const res = await tursoClient.execute({
    sql: `SELECT last_updated_at FROM bot_users_session
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND bot_user_id = :botUserId`,
    args: { userId, platformId, sessionId, botUserId },
  });
  const row = res.rows[0] as { last_updated_at: string } | undefined;
  return row?.last_updated_at ? new Date(row.last_updated_at) : null;
}

/** Returns 'Unknown user' when the user has not been synced yet — safe fallback for display. */
export async function getUserName(userId: string): Promise<string> {
  const res = await tursoClient.execute({
    sql: `SELECT name FROM bot_users WHERE id = :userId`,
    args: { userId },
  });
  const row = res.rows[0] as { name: string } | undefined;
  return row?.name ?? 'Unknown user';
}

export async function getUserAvatar(userId: string): Promise<string | null> {
  const res = await tursoClient.execute({
    sql: `SELECT avatar_url FROM bot_users WHERE id = :userId`,
    args: { userId },
  });
  const row = res.rows[0] as { avatar_url: string | null } | undefined;
  return row?.avatar_url ?? null;
}

export async function updateUserAvatar(
  userId: string,
  avatarUrl: string,
): Promise<void> {
  await tursoClient.execute({
    sql: `UPDATE bot_users SET avatar_url = :avatarUrl WHERE id = :userId`,
    args: { avatarUrl, userId },
  });
}

/**
 * Reads the JSON data blob for a bot_users_session row.
 * Returns an empty object on missing row, null data, or parse failure.
 */
export async function getUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<Record<string, unknown>> {
  const platformId = toPlatformNumericId(platform);
  const res = await tursoClient.execute({
    sql: `SELECT data FROM bot_users_session
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND bot_user_id = :botUserId`,
    args: { userId, platformId, sessionId, botUserId },
  });
  const row = res.rows[0] as { data: string | null } | undefined;
  if (!row?.data) return {};
  try {
    return JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Writes the JSON data blob. UPDATE with no matching row is a silent no-op.
 */
export async function setUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await tursoClient.execute({
    sql: `UPDATE bot_users_session SET data = :data
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND bot_user_id = :botUserId`,
    args: {
      userId,
      platformId,
      sessionId,
      botUserId,
      data: JSON.stringify(data),
    },
  });
}

/**
 * Returns all bot_users_session records with parsed data blobs.
 * Used by the rank command to sort all users by EXP and compute leaderboard position.
 */
export async function getAllUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ botUserId: string; data: Record<string, unknown> }>> {
  const platformId = toPlatformNumericId(platform);
  const res = await tursoClient.execute({
    sql: `SELECT bot_user_id, data FROM bot_users_session
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId`,
    args: { userId, platformId, sessionId },
  });
  return (
    res.rows as unknown as Array<{ bot_user_id: string; data: string | null }>
  ).map((row) => {
    let data: Record<string, unknown> = {};
    if (row.data) {
      try {
        data = JSON.parse(row.data) as Record<string, unknown>;
      } catch {
        /* malformed JSON — default to empty object */
      }
    }
    return { botUserId: row.bot_user_id, data };
  });
}
