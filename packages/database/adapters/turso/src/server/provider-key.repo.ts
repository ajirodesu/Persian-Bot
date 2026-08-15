import { tursoClient } from '../client.js';

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
}

interface GroqKeyRow {
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
}

const NOW_SQL = `STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`;

export async function getUserAiConfig(
  userId: string,
): Promise<StoredAiConfig | null> {
  const res = await tursoClient.execute({
    sql: `SELECT encrypted_key, key_hint, openrouter_encrypted_key, openrouter_key_hint,
                 nvidia_encrypted_key, nvidia_key_hint, provider, groq_model,
                 openrouter_model, nvidia_model
          FROM bot_user_groq_key WHERE user_id = :userId`,
    args: { userId },
  });
  const row = res.rows[0] as GroqKeyRow | undefined;
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
  };
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
 * first. Fresh rows provide '' for the inactive providers' columns.
 */
export async function saveUserAiKey(
  userId: string,
  provider: AiProvider,
  encryptedKey: string,
  keyHint: string,
  model: string,
): Promise<void> {
  if (provider === 'openrouter') {
    await tursoClient.execute({
      sql: `INSERT INTO bot_user_groq_key
              (user_id, encrypted_key, key_hint, openrouter_encrypted_key,
               openrouter_key_hint, provider, groq_model, openrouter_model, updated_at)
            VALUES (:userId, '', '', :enc, :hint, 'openrouter', '', :model, ${NOW_SQL})
            ON CONFLICT (user_id) DO UPDATE SET
              openrouter_encrypted_key = excluded.openrouter_encrypted_key,
              openrouter_key_hint      = excluded.openrouter_key_hint,
              provider                 = excluded.provider,
              openrouter_model         = excluded.openrouter_model,
              updated_at               = ${NOW_SQL}`,
      args: { userId, enc: encryptedKey, hint: keyHint, model },
    });
    return;
  }
  if (provider === 'nvidia') {
    await tursoClient.execute({
      sql: `INSERT INTO bot_user_groq_key
              (user_id, encrypted_key, key_hint, openrouter_encrypted_key,
               openrouter_key_hint, nvidia_encrypted_key, nvidia_key_hint,
               provider, groq_model, openrouter_model, nvidia_model, updated_at)
            VALUES (:userId, '', '', '', '', :enc, :hint, 'nvidia', '', '', :model, ${NOW_SQL})
            ON CONFLICT (user_id) DO UPDATE SET
              nvidia_encrypted_key = excluded.nvidia_encrypted_key,
              nvidia_key_hint      = excluded.nvidia_key_hint,
              provider             = excluded.provider,
              nvidia_model         = excluded.nvidia_model,
              updated_at           = ${NOW_SQL}`,
      args: { userId, enc: encryptedKey, hint: keyHint, model },
    });
    return;
  }
  await tursoClient.execute({
    sql: `INSERT INTO bot_user_groq_key
            (user_id, encrypted_key, key_hint, openrouter_encrypted_key,
             openrouter_key_hint, provider, groq_model, openrouter_model, updated_at)
          VALUES (:userId, :enc, :hint, '', '', 'groq', :model, '', ${NOW_SQL})
          ON CONFLICT (user_id) DO UPDATE SET
            encrypted_key = excluded.encrypted_key,
            key_hint      = excluded.key_hint,
            provider      = excluded.provider,
            groq_model    = excluded.groq_model,
            updated_at    = ${NOW_SQL}`,
    args: { userId, enc: encryptedKey, hint: keyHint, model },
  });
}

/** Switches the active provider + its remembered model without touching keys. */
export async function updateUserAiModel(
  userId: string,
  provider: AiProvider,
  model: string,
): Promise<void> {
  if (provider === 'openrouter') {
    await tursoClient.execute({
      sql: `UPDATE bot_user_groq_key
            SET provider = 'openrouter', openrouter_model = :model, updated_at = ${NOW_SQL}
            WHERE user_id = :userId`,
      args: { userId, model },
    });
    return;
  }
  if (provider === 'nvidia') {
    await tursoClient.execute({
      sql: `UPDATE bot_user_groq_key
            SET provider = 'nvidia', nvidia_model = :model, updated_at = ${NOW_SQL}
            WHERE user_id = :userId`,
      args: { userId, model },
    });
    return;
  }
  await tursoClient.execute({
    sql: `UPDATE bot_user_groq_key
          SET provider = 'groq', groq_model = :model, updated_at = ${NOW_SQL}
          WHERE user_id = :userId`,
    args: { userId, model },
  });
}

/** Clears the encrypted key columns for ONE provider ('' = not configured). */
export async function deleteUserAiKey(
  userId: string,
  provider: AiProvider,
): Promise<void> {
  if (provider === 'openrouter') {
    await tursoClient.execute({
      sql: `UPDATE bot_user_groq_key
            SET openrouter_encrypted_key = '', openrouter_key_hint = '', updated_at = ${NOW_SQL}
            WHERE user_id = :userId`,
      args: { userId },
    });
    return;
  }
  if (provider === 'nvidia') {
    await tursoClient.execute({
      sql: `UPDATE bot_user_groq_key
            SET nvidia_encrypted_key = '', nvidia_key_hint = '', updated_at = ${NOW_SQL}
            WHERE user_id = :userId`,
      args: { userId },
    });
    return;
  }
  await tursoClient.execute({
    sql: `UPDATE bot_user_groq_key
          SET encrypted_key = '', key_hint = '', updated_at = ${NOW_SQL}
          WHERE user_id = :userId`,
    args: { userId },
  });
}
