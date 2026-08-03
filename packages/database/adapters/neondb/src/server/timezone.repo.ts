import { pool } from '../client.js';

export async function getUserTimezone(userId: string): Promise<string | null> {
  const res = await pool.query<{ timezone: string }>(
    `SELECT timezone FROM bot_user_timezone WHERE user_id = $1`,
    [userId],
  );
  return res.rows[0]?.timezone ?? null;
}

export async function upsertUserTimezone(
  userId: string,
  timezone: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO bot_user_timezone (user_id, timezone, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       timezone = EXCLUDED.timezone,
       updated_at = NOW()`,
    [userId, timezone],
  );
}

export async function deleteUserTimezone(userId: string): Promise<void> {
  await pool.query(`DELETE FROM bot_user_timezone WHERE user_id = $1`, [
    userId,
  ]);
}
