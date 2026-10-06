import { tursoClient } from '../client.js';

// Providers with dedicated encrypted-key/model columns in bot_user_ai_config.
// Any other provider (deepinfra, venice, together, fireworks, lepton, ollama,
// lmstudio, custom) plus base URLs live in the agent_settings JSON blob.
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
  const res = await tursoClient.execute({
    sql: `SELECT ${SELECT_COLS} FROM bot_user_ai_config WHERE user_id = :userId`,
    args: { userId },
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ?? null;
}

export async function saveUserAiConfig(
  userId: string,
  cols: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(cols).filter(([k]) => ALLOWED_WRITE_COLS.has(k));
  if (entries.length === 0) return;

  const names = entries.map(([k]) => k);
  const placeholders = names.map((n) => `:${n}`).join(', ');
  const updates = names.map((n) => `${n} = excluded.${n}`).join(', ');
  const args: Record<string, unknown> = { userId };
  for (const [k, v] of entries) args[k] = v;

  await tursoClient.execute({
    sql: `INSERT INTO bot_user_ai_config (user_id, ${names.join(', ')}, updated_at)
          VALUES (:userId, ${placeholders}, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT (user_id) DO UPDATE SET
            ${updates},
            updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    args,
  });
}

export async function deleteUserAiConfig(userId: string): Promise<void> {
  await tursoClient.execute({
    sql: `DELETE FROM bot_user_ai_config WHERE user_id = :userId`,
    args: { userId },
  });
}
