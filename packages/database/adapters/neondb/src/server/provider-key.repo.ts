import { pool } from '../client.js';

/**
 * Per-user AI provider configuration stored in bot_user_groq_key (the table name
 * predates the multi-provider feature and is kept for migration compatibility).
 *
 * Each user may configure a key for ANY provider (or several) — groq keys live
 * in encrypted_key/key_hint, openrouter keys in openrouter_encrypted_key/
 * openrouter_key_hint, nvidia keys in nvidia_encrypted_key/nvidia_key_hint.
 * `provider` selects the active one, and each provider's model choice is
 * remembered independently so switching providers keeps the user's preferred
 * model for each.
 */
export type AiProvider = 'openrouter' | 'groq' | 'nvidia';

export interface StoredAiConfig {
  encryptedKey: string;
  keyHint: string;
  openrouterEncryptedKey: string;
  openrouterKeyHint: string;
  nvidiaEncryptedKey: string;
  nvidiaKeyHint: string;
  provider: AiProvider;
  groqModel: string;
  openrouterModel: string;
  nvidiaModel: string;
  /**
   * Free-form per-user agent settings blob (JSON). Holds everything that isn't
   * one of the provider key/model columns: the trigger word, agent behavior
   * toggles/limits, and the OpenAI/Gemini key+model slots. Always an object;
   * missing/unparseable → {}.
   */
  agentSettings: Record<string, unknown>;
}

export async function getUserAiConfig(
  userId: string,
): Promise<StoredAiConfig | null> {
  const res = await pool.query<{
    encrypted_key: string | null;
    key_hint: string | null;
    openrouter_encrypted_key: string | null;
    openrouter_key_hint: string | null;
    nvidia_encrypted_key: string | null;
    nvidia_key_hint: string | null;
    provider: string | null;
    groq_model: string | null;
    openrouter_model: string | null;
    nvidia_model: string | null;
    agent_settings: string | null;
  }>(
    `SELECT encrypted_key, key_hint, openrouter_encrypted_key, openrouter_key_hint,
            nvidia_encrypted_key, nvidia_key_hint, provider, groq_model,
            openrouter_model, nvidia_model, agent_settings
     FROM bot_user_groq_key WHERE user_id = $1`,
    [userId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    encryptedKey: row.encrypted_key ?? '',
    keyHint: row.key_hint ?? '',
    openrouterEncryptedKey: row.openrouter_encrypted_key ?? '',
    openrouterKeyHint: row.openrouter_key_hint ?? '',
    nvidiaEncryptedKey: row.nvidia_encrypted_key ?? '',
    nvidiaKeyHint: row.nvidia_key_hint ?? '',
    provider: providerOf(row.provider),
    groqModel: row.groq_model ?? '',
    openrouterModel: row.openrouter_model ?? '',
    nvidiaModel: row.nvidia_model ?? '',
    agentSettings: parseAgentSettings(row.agent_settings),
  };
}

/** Parses the agent_settings JSON column — never throws, always an object. */
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

/**
 * Merges the given agent settings into the user's stored blob (JSON column)
 * and upserts the row when it doesn't exist yet. Existing provider key/model
 * columns are untouched.
 */
export async function saveUserAgentSettings(
  userId: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const current = await pool.query<{ agent_settings: string | null }>(
    `SELECT agent_settings FROM bot_user_groq_key WHERE user_id = $1`,
    [userId],
  );
  const merged = {
    ...parseAgentSettings(current.rows[0]?.agent_settings ?? null),
    ...settings,
  };
  await pool.query(
    `INSERT INTO bot_user_groq_key (user_id, agent_settings, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       agent_settings = EXCLUDED.agent_settings,
       updated_at     = NOW()`,
    [userId, JSON.stringify(merged)],
  );
}

function providerOf(value: string | null): AiProvider {
  if (value === 'groq') return 'groq';
  if (value === 'nvidia') return 'nvidia';
  return 'openrouter';
}

/**
 * Upserts the encrypted key for ONE provider and makes that provider active
 * with the given model. The other providers' key/model columns are untouched by
 * the ON CONFLICT UPDATE, so configuring another provider never wipes the
 * first. Fresh rows provide '' (or NULL for the nullable columns) for the
 * inactive providers' columns.
 */
export async function saveUserAiKey(
  userId: string,
  provider: AiProvider,
  encryptedKey: string,
  keyHint: string,
  model: string,
): Promise<void> {
  if (provider === 'openrouter') {
    await pool.query(
      `INSERT INTO bot_user_groq_key
         (user_id, encrypted_key, key_hint, openrouter_encrypted_key,
          openrouter_key_hint, provider, groq_model, openrouter_model, updated_at)
       VALUES ($1, '', '', $2, $3, 'openrouter', '', $4, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         openrouter_encrypted_key = EXCLUDED.openrouter_encrypted_key,
         openrouter_key_hint      = EXCLUDED.openrouter_key_hint,
         provider                 = EXCLUDED.provider,
         openrouter_model         = EXCLUDED.openrouter_model,
         updated_at               = NOW()`,
      [userId, encryptedKey, keyHint, model],
    );
    return;
  }
  if (provider === 'nvidia') {
    await pool.query(
      `INSERT INTO bot_user_groq_key
         (user_id, encrypted_key, key_hint, openrouter_encrypted_key,
          openrouter_key_hint, nvidia_encrypted_key, nvidia_key_hint, provider,
          groq_model, openrouter_model, nvidia_model, updated_at)
       VALUES ($1, '', '', '', '', $2, $3, 'nvidia', '', '', $4, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         nvidia_encrypted_key = EXCLUDED.nvidia_encrypted_key,
         nvidia_key_hint      = EXCLUDED.nvidia_key_hint,
         provider             = EXCLUDED.provider,
         nvidia_model         = EXCLUDED.nvidia_model,
         updated_at           = NOW()`,
      [userId, encryptedKey, keyHint, model],
    );
    return;
  }
  await pool.query(
    `INSERT INTO bot_user_groq_key
       (user_id, encrypted_key, key_hint, openrouter_encrypted_key,
        openrouter_key_hint, provider, groq_model, openrouter_model, updated_at)
     VALUES ($1, $2, $3, '', '', 'groq', $4, '', NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       encrypted_key = EXCLUDED.encrypted_key,
       key_hint      = EXCLUDED.key_hint,
       provider      = EXCLUDED.provider,
       groq_model    = EXCLUDED.groq_model,
       updated_at    = NOW()`,
    [userId, encryptedKey, keyHint, model],
  );
}

/** Switches the active provider + its remembered model without touching keys. */
export async function updateUserAiModel(
  userId: string,
  provider: AiProvider,
  model: string,
): Promise<void> {
  if (provider === 'openrouter') {
    await pool.query(
      `UPDATE bot_user_groq_key
       SET provider = 'openrouter', openrouter_model = $2, updated_at = NOW()
       WHERE user_id = $1`,
      [userId, model],
    );
    return;
  }
  if (provider === 'nvidia') {
    await pool.query(
      `UPDATE bot_user_groq_key
       SET provider = 'nvidia', nvidia_model = $2, updated_at = NOW()
       WHERE user_id = $1`,
      [userId, model],
    );
    return;
  }
  await pool.query(
    `UPDATE bot_user_groq_key
     SET provider = 'groq', groq_model = $2, updated_at = NOW()
     WHERE user_id = $1`,
    [userId, model],
  );
}

/** Clears the encrypted key columns for ONE provider ('' = not configured). */
export async function deleteUserAiKey(
  userId: string,
  provider: AiProvider,
): Promise<void> {
  if (provider === 'openrouter') {
    await pool.query(
      `UPDATE bot_user_groq_key
       SET openrouter_encrypted_key = '', openrouter_key_hint = '', updated_at = NOW()
       WHERE user_id = $1`,
      [userId],
    );
    return;
  }
  if (provider === 'nvidia') {
    await pool.query(
      `UPDATE bot_user_groq_key
       SET nvidia_encrypted_key = '', nvidia_key_hint = '', updated_at = NOW()
       WHERE user_id = $1`,
      [userId],
    );
    return;
  }
  await pool.query(
    `UPDATE bot_user_groq_key
     SET encrypted_key = '', key_hint = '', updated_at = NOW()
     WHERE user_id = $1`,
    [userId],
  );
}
