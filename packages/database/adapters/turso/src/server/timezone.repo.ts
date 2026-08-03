import { tursoClient } from '../client.js';

export async function getUserTimezone(userId: string): Promise<string | null> {
  const res = await tursoClient.execute({
    sql: `SELECT timezone FROM bot_user_timezone WHERE user_id = :userId`,
    args: { userId },
  });
  const row = res.rows[0] as { timezone: string } | undefined;
  return row ? row.timezone : null;
}

export async function upsertUserTimezone(
  userId: string,
  timezone: string,
): Promise<void> {
  await tursoClient.execute({
    sql: `INSERT INTO bot_user_timezone (user_id, timezone, updated_at)
          VALUES (:userId, :timezone, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT (user_id) DO UPDATE SET
            timezone = excluded.timezone,
            updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    args: { userId, timezone },
  });
}

export async function deleteUserTimezone(userId: string): Promise<void> {
  await tursoClient.execute({
    sql: `DELETE FROM bot_user_timezone WHERE user_id = :userId`,
    args: { userId },
  });
}
