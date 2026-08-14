import { pool } from '../client.js';

/**
 * Per-user AI provider configuration stored in bot_user_groq_key (the table name
 * predates the multi-provider feature and is kept for migration compatibility).
 *
 * Each user may configure a key for EITHER provider (or both) — groq keys live
 * in encrypted_key/key_hint, openrouter keys in openrouter_encrypted_key/
 * openrouter_key_hint. `provider` selects the active one, and each provider's
 * model choice is remembered independently so switching providers keeps the
 * user's preferred model for each.
 */
export type AiProvider = 'groq' | 'openrouter';

export interface StoredAiConfig {
  encryptedKey: string;
  keyHint: string;
  openrouterEncryptedKey: string;
  openrouterKeyHint: string;
  provider: AiProvider;
  groqModel: string;
  openrouterModel: string;
}

export async function getUserAiConfig(
  userId: string,
): Promise<StoredAiConfig | null> {
  const res = await pool.query<{
    encrypted_key: string | null;
    key_hint: string | null;
    openrouter_encrypted_key: string | null;
    openrouter_key_hint: string | null;
    provider: string | null;
    groq_model: string | null;
    openrouter_model: string | null;
  }>(
    `SELECT encrypted_key, key_hint, openrouter_encrypted_key, openrouter_key_hint,
            provider, groq_model, openrouter_model
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
    provider: row.provider === 'openrouter' ? 'openrouter' : 'groq',
    groqModel: row.groq_model ?? '',
    openrouterModel: row.openrouter_model ?? '',
  };
}

/**
 * Upserts the encrypted key for ONE provider and makes that provider active
 * with the given model. The other provider's key/model columns are untouched by
 * the ON CONFLICT UPDATE, so configuring a second provider never wipes the
 * first. Fresh rows provide '' for the inactive provider's columns (existing
 * NOT NULL columns would otherwise reject the insert).
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
  await pool.query(
    `UPDATE bot_user_groq_key
     SET encrypted_key = '', key_hint = '', updated_at = NOW()
     WHERE user_id = $1`,
    [userId],
  );
}
