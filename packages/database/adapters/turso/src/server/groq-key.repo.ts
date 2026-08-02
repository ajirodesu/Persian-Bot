import { tursoClient } from '../client.js';

export interface StoredGroqKey {
  encryptedKey: string;
  keyHint: string;
}

export async function getUserGroqKey(
  userId: string,
): Promise<StoredGroqKey | null> {
  const res = await tursoClient.execute({
    sql: `SELECT encrypted_key, key_hint FROM bot_user_groq_key WHERE user_id = :userId`,
    args: { userId },
  });
  const row = res.rows[0] as
    | { encrypted_key: string; key_hint: string }
    | undefined;
  return row
    ? { encryptedKey: row.encrypted_key, keyHint: row.key_hint }
    : null;
}

export async function upsertUserGroqKey(
  userId: string,
  encryptedKey: string,
  keyHint: string,
): Promise<void> {
  await tursoClient.execute({
    sql: `INSERT INTO bot_user_groq_key (user_id, encrypted_key, key_hint, updated_at)
          VALUES (:userId, :encryptedKey, :keyHint, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT (user_id) DO UPDATE SET
            encrypted_key = excluded.encrypted_key,
            key_hint = excluded.key_hint,
            updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    args: { userId, encryptedKey, keyHint },
  });
}

export async function deleteUserGroqKey(userId: string): Promise<void> {
  await tursoClient.execute({
    sql: `DELETE FROM bot_user_groq_key WHERE user_id = :userId`,
    args: { userId },
  });
}
