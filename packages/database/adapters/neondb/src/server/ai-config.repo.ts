import { pool } from '../client.js';

const COLUMN_PROVIDERS = [
  'openrouter',
  'groq',
  'nvidia',
  'openai',
  'gemini',
  'zen',
  'orcarouter',
  'fastrouter',
  'huggingface',
  'tokenrouter',
] as const;

const SELECT_COLS = [
  'user_id',
  'provider',
  'agent_settings',
  ...COLUMN_PROVIDERS.flatMap((p) => [
    `${p}_encrypted_key`,
    `${p}_key_hint`,
    `${p}_model`,
  ]),
].join(', ');

const ALLOWED_WRITE_COLS = new Set<string>([
  'provider',
  'agent_settings',
  ...COLUMN_PROVIDERS.flatMap((p) => [
    `${p}_encrypted_key`,
    `${p}_key_hint`,
    `${p}_model`,
  ]),
]);

export async function getUserAiConfig(
  userId: string,
): Promise<Record<string, unknown> | null> {
  const res = await pool.query(
    `SELECT ${SELECT_COLS} FROM bot_user_ai_config WHERE user_id = $1`,
    [userId],
  );
  return (res.rows[0] as Record<string, unknown> | undefined) ?? null;
}

export async function saveUserAiConfig(
  userId: string,
  cols: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(cols).filter(([k]) => ALLOWED_WRITE_COLS.has(k));
  if (entries.length === 0) return;

  const names = entries.map(([k]) => k);
  const values = entries.map(([, v]) => v);
  const placeholders = names.map((_, i) => `$${i + 2}`).join(', ');
  const updates = names.map((n) => `${n} = EXCLUDED.${n}`).join(', ');

  await pool.query(
    `INSERT INTO bot_user_ai_config (user_id, ${names.join(', ')}, updated_at)
     VALUES ($1, ${placeholders}, NOW())
     ON CONFLICT (user_id) DO UPDATE SET ${updates}, updated_at = NOW()`,
    [userId, ...values],
  );
}

export async function deleteUserAiConfig(userId: string): Promise<void> {
  await pool.query(`DELETE FROM bot_user_ai_config WHERE user_id = $1`, [userId]);
}
