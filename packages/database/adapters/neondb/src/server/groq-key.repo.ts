import { pool } from '../client.js';

export interface StoredGroqKey {
  encryptedKey: string;
  keyHint: string;
}

export async function getUserGroqKey(
  userId: string,
): Promise<StoredGroqKey | null> {
  const res = await pool.query<{ encrypted_key: string; key_hint: string }>(
    `SELECT encrypted_key, key_hint FROM bot_user_groq_key WHERE user_id = $1`,
    [userId],
  );
  const row = res.rows[0];
  return row
    ? { encryptedKey: row.encrypted_key, keyHint: row.key_hint }
    : null;
}

export async function upsertUserGroqKey(
  userId: string,
  encryptedKey: string,
  keyHint: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO bot_user_groq_key (user_id, encrypted_key, key_hint, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       encrypted_key = EXCLUDED.encrypted_key,
       key_hint = EXCLUDED.key_hint,
       updated_at = NOW()`,
    [userId, encryptedKey, keyHint],
  );
}

export async function deleteUserGroqKey(userId: string): Promise<void> {
  await pool.query(`DELETE FROM bot_user_groq_key WHERE user_id = $1`, [
    userId,
  ]);
}
