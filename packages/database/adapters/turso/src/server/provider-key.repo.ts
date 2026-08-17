import { tursoClient } from '../client.js';

/**
 * Per-user AI provider configuration stored in bot_user_ai_config — one
 * key/hint/model column pair per provider (openrouter, groq, nvidia, openai,
 * gemini). `provider` selects the active one, and each provider's model choice
 * is remembered independently so switching providers keeps the user's preferred
 * model for each. The legacy bot_user_groq_key table (predates the
 * multi-provider feature) is migrated to this schema by initDb.
 */
export type AiProvider = 'openrouter' | 'groq' | 'nvidia' | 'openai' | 'gemini';

export interface StoredAiConfig {
  provider: AiProvider;
  openrouterEncryptedKey: string;
  openrouterKeyHint: string;
  openrouterModel: string;
  groqEncryptedKey: string;
  groqKeyHint: string;
  groqModel: string;
  nvidiaEncryptedKey: string;
  nvidiaKeyHint: string;
  nvidiaModel: string;
  openaiEncryptedKey: string;
  openaiKeyHint: string;
  openaiModel: string;
  geminiEncryptedKey: string;
  geminiKeyHint: string;
  geminiModel: string;
  /**
   * Free-form per-user agent settings blob (JSON). Holds the agent behavior
   * settings: trigger word, behavior toggles/limits. Provider keys/models all
   * live in their own columns. Always an object; missing/unparseable → {}.
   */
  agentSettings: Record<string, unknown>;
}

const PROVIDER_COLUMNS = [
  'openrouter_encrypted_key',
  'openrouter_key_hint',
  'openrouter_model',
  'groq_encrypted_key',
  'groq_key_hint',
  'groq_model',
  'nvidia_encrypted_key',
  'nvidia_key_hint',
  'nvidia_model',
  'openai_encrypted_key',
  'openai_key_hint',
  'openai_model',
  'gemini_encrypted_key',
  'gemini_key_hint',
  'gemini_model',
] as const;

const NOW_SQL = `STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`;

function providerOf(value: string | null): AiProvider {
  return value === 'groq' ||
    value === 'nvidia' ||
    value === 'openai' ||
    value === 'gemini'
    ? value
    : 'openrouter';
}

function providerColumn(
  provider: AiProvider,
  suffix: 'encrypted_key' | 'key_hint' | 'model',
): string {
  return `${provider}_${suffix}`;
}

/** Parses the agent_settings TEXT column — never throws, always an object. */
function parseAgentSettings(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to {}.
  }
  return {};
}

function mapStoredConfig(row: Record<string, unknown>): StoredAiConfig {
  const out: StoredAiConfig = {
    provider: providerOf(row['provider'] as string | null),
    agentSettings: parseAgentSettings(row['agent_settings'] as string | null),
  } as StoredAiConfig;
  for (const col of PROVIDER_COLUMNS) {
    // Cols look like "openrouter_encrypted_key" — split('_') would wrongly give
    // suffix "encrypted" (the suffix itself contains an underscore), so match
    // the full pattern instead to resolve the correct field name.
    const match = /^([a-z]+)_(encrypted_key|key_hint|model)$/.exec(col);
    if (!match) continue;
    const provider = match[1] as AiProvider;
    const suffix = match[2] as 'encrypted_key' | 'key_hint' | 'model';
    const field =
      suffix === 'encrypted_key'
        ? `${provider}EncryptedKey`
        : suffix === 'key_hint'
          ? `${provider}KeyHint`
          : `${provider}Model`;
    (out as unknown as Record<string, unknown>)[field] = String(row[col] ?? '');
  }
  return out;
}

export async function getUserAiConfig(
  userId: string,
): Promise<StoredAiConfig | null> {
  const res = await tursoClient.execute({
    sql: `SELECT ${PROVIDER_COLUMNS.join(', ')}, provider, agent_settings
          FROM bot_user_ai_config WHERE user_id = :userId`,
    args: { userId },
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapStoredConfig(row);
}

/**
 * Merges the given agent settings into the user's stored blob (TEXT column)
 * and upserts the row when it doesn't exist yet. Existing provider key/model
 * columns are untouched.
 */
export async function saveUserAgentSettings(
  userId: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const current = await tursoClient.execute({
    sql: `SELECT agent_settings FROM bot_user_ai_config WHERE user_id = :userId`,
    args: { userId },
  });
  const row = current.rows[0] as { agent_settings?: string | null } | undefined;
  const merged = {
    ...parseAgentSettings(row?.agent_settings ?? null),
    ...settings,
  };
  await tursoClient.execute({
    sql: `INSERT INTO bot_user_ai_config
            (user_id, agent_settings, updated_at)
          VALUES (:userId, :settings, ${NOW_SQL})
          ON CONFLICT (user_id) DO UPDATE SET
            agent_settings = excluded.agent_settings,
            updated_at     = ${NOW_SQL}`,
    args: { userId, settings: JSON.stringify(merged) },
  });
}

/**
 * Upserts the encrypted key for ONE provider and makes that provider active
 * with the given model. The other providers' key/model columns are untouched by
 * the ON CONFLICT UPDATE, so configuring another provider never wipes the
 * first. Fresh rows provide NULL for the inactive providers' columns.
 */
export async function saveUserAiKey(
  userId: string,
  provider: AiProvider,
  encryptedKey: string,
  keyHint: string,
  model: string,
): Promise<void> {
  const keyCol = providerColumn(provider, 'encrypted_key');
  const hintCol = providerColumn(provider, 'key_hint');
  const modelCol = providerColumn(provider, 'model');
  await tursoClient.execute({
    sql: `INSERT INTO bot_user_ai_config
            (user_id, ${keyCol}, ${hintCol}, ${modelCol}, provider, updated_at)
          VALUES (:userId, :enc, :hint, :model, :provider, ${NOW_SQL})
          ON CONFLICT (user_id) DO UPDATE SET
            ${keyCol}   = excluded.${keyCol},
            ${hintCol}  = excluded.${hintCol},
            ${modelCol} = excluded.${modelCol},
            provider    = excluded.provider,
            updated_at  = ${NOW_SQL}`,
    args: { userId, enc: encryptedKey, hint: keyHint, model, provider },
  });
}

/** Switches the active provider + its remembered model without touching keys. */
export async function updateUserAiModel(
  userId: string,
  provider: AiProvider,
  model: string,
): Promise<void> {
  const modelCol = providerColumn(provider, 'model');
  await tursoClient.execute({
    sql: `UPDATE bot_user_ai_config
          SET provider = :provider, ${modelCol} = :model, updated_at = ${NOW_SQL}
          WHERE user_id = :userId`,
    args: { userId, provider, model },
  });
}

/** Clears the encrypted key columns for ONE provider ('' = not configured). */
export async function deleteUserAiKey(
  userId: string,
  provider: AiProvider,
): Promise<void> {
  const keyCol = providerColumn(provider, 'encrypted_key');
  const hintCol = providerColumn(provider, 'key_hint');
  await tursoClient.execute({
    sql: `UPDATE bot_user_ai_config
          SET ${keyCol} = '', ${hintCol} = '', updated_at = ${NOW_SQL}
          WHERE user_id = :userId`,
    args: { userId },
  });
}