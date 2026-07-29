import { tursoClient, intToBool } from '../client.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

// ── User Bans ─────────────────────────────────────────────────────────────────

/** Bans a user. Upserts so calling ban twice is idempotent; reason is updated. */
export async function banUser(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
  reason?: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await tursoClient.execute({
    sql: `INSERT INTO bot_users_session_banned (user_id, platform_id, session_id, bot_user_id, is_banned, reason)
          VALUES (:userId, :platformId, :sessionId, :botUserId, 1, :reason)
          ON CONFLICT (user_id, platform_id, session_id, bot_user_id)
          DO UPDATE SET is_banned = 1, reason = excluded.reason`,
    args: { userId, platformId, sessionId, botUserId, reason: reason ?? null },
  });
}

/** Lifts a user ban. Sets is_banned=0 so the reason row is preserved for audit. */
export async function unbanUser(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // UPDATE instead of DELETE — preserves the reason field for audit history.
  await tursoClient.execute({
    sql: `UPDATE bot_users_session_banned
          SET is_banned = 0
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND bot_user_id = :botUserId`,
    args: { userId, platformId, sessionId, botUserId },
  });
}

/**
 * Returns true when the user is actively banned. Fail-open: a missing row or
 * any DB error returns false so a temporary outage never locks out legitimate users.
 */
export async function isUserBanned(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<boolean> {
  try {
    const platformId = toPlatformNumericId(platform);
    const res = await tursoClient.execute({
      sql: `SELECT is_banned FROM bot_users_session_banned
            WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND bot_user_id = :botUserId`,
      args: { userId, platformId, sessionId, botUserId },
    });
    const row = res.rows[0] as { is_banned: number } | undefined;
    return row ? intToBool(row.is_banned) : false;
  } catch {
    return false;
  }
}

/**
 * Returns the stored ban reason for a user, or null when unbanned/absent/on error.
 * Fail-open — never throws, so a message-formatting call site can't crash on a DB blip.
 */
export async function getUserBanReason(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<string | null> {
  try {
    const platformId = toPlatformNumericId(platform);
    const res = await tursoClient.execute({
      sql: `SELECT reason FROM bot_users_session_banned
            WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND bot_user_id = :botUserId`,
      args: { userId, platformId, sessionId, botUserId },
    });
    const row = res.rows[0] as { reason: string | null } | undefined;
    return row?.reason ?? null;
  } catch {
    return null;
  }
}

// ── Thread Bans ───────────────────────────────────────────────────────────────

/** Bans a thread. Idempotent — reason is updated on re-ban. */
export async function banThread(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
  reason?: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await tursoClient.execute({
    sql: `INSERT INTO bot_threads_session_banned (user_id, platform_id, session_id, bot_thread_id, is_banned, reason)
          VALUES (:userId, :platformId, :sessionId, :botThreadId, 1, :reason)
          ON CONFLICT (user_id, platform_id, session_id, bot_thread_id)
          DO UPDATE SET is_banned = 1, reason = excluded.reason`,
    args: {
      userId,
      platformId,
      sessionId,
      botThreadId,
      reason: reason ?? null,
    },
  });
}

/** Lifts a thread ban. Preserves the row so reason is retained for audit. */
export async function unbanThread(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await tursoClient.execute({
    sql: `UPDATE bot_threads_session_banned
          SET is_banned = 0
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND bot_thread_id = :botThreadId`,
    args: { userId, platformId, sessionId, botThreadId },
  });
}

/** Returns true when the thread is actively banned. Fail-open on DB error. */
export async function isThreadBanned(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<boolean> {
  try {
    const platformId = toPlatformNumericId(platform);
    const res = await tursoClient.execute({
      sql: `SELECT is_banned FROM bot_threads_session_banned
            WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND bot_thread_id = :botThreadId`,
      args: { userId, platformId, sessionId, botThreadId },
    });
    const row = res.rows[0] as { is_banned: number } | undefined;
    return row ? intToBool(row.is_banned) : false;
  } catch {
    return false;
  }
}

/**
 * Returns the stored ban reason for a thread, or null when unbanned/absent/on error.
 * Fail-open — never throws, so a message-formatting call site can't crash on a DB blip.
 */
export async function getThreadBanReason(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<string | null> {
  try {
    const platformId = toPlatformNumericId(platform);
    const res = await tursoClient.execute({
      sql: `SELECT reason FROM bot_threads_session_banned
            WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND bot_thread_id = :botThreadId`,
      args: { userId, platformId, sessionId, botThreadId },
    });
    const row = res.rows[0] as { reason: string | null } | undefined;
    return row?.reason ?? null;
  } catch {
    return null;
  }
}
