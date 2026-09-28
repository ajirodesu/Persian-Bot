import { pool } from '../client.js';

/**
 * AI Agent Config Store — deployment-level Cactus Needle 3 connection settings.
 *
 * Stored as a JSON blob in the system_settings table (DDL in client.ts
 * initDb) under the `aiAgentConfig` key, upserted in place. The Needle auth
 * token is encrypted (AES-256-GCM, enc:v1:) by the cat-bot layer before it
 * reaches this store — the adapter is encryption-agnostic.
 */

export interface AiAgentConfigStoreValue {
  enabled: boolean;
  /** Needle 3 service base URL (e.g. https://…onrender.com). Empty = unconfigured. */
  needleUrl: string;
  /** AES-256-GCM encrypted Needle Bearer token (enc:v1:…). Empty = none set. */
  encryptedToken: string;
  timeoutMs: number;
  /** Minimum Needle confidence required before executing a tool call (0-1). */
  confidenceThreshold: number;
  updatedAt: string;
}

const KEY = 'aiAgentConfig';

function parseValue(raw: string | undefined | null): AiAgentConfigStoreValue | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<AiAgentConfigStoreValue>;
    if (typeof v.enabled !== 'boolean') return null;
    return {
      enabled: v.enabled,
      needleUrl: typeof v.needleUrl === 'string' ? v.needleUrl : '',
      encryptedToken:
        typeof v.encryptedToken === 'string' ? v.encryptedToken : '',
      timeoutMs:
        typeof v.timeoutMs === 'number' && Number.isFinite(v.timeoutMs)
          ? v.timeoutMs
          : 300000,
      confidenceThreshold:
        typeof v.confidenceThreshold === 'number' &&
        Number.isFinite(v.confidenceThreshold)
          ? v.confidenceThreshold
          : 0.7,
      updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : '',
    };
  } catch {
    return null;
  }
}

export async function getAiAgentConfigStore(): Promise<AiAgentConfigStoreValue | null> {
  const res = await pool.query<{ settings_value: string }>(
    `SELECT settings_value FROM system_settings WHERE setting_key = $1 LIMIT 1`,
    [KEY],
  );
  return parseValue(res.rows[0]?.settings_value);
}

export async function saveAiAgentConfigStore(
  value: AiAgentConfigStoreValue,
): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (setting_key, settings_value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (setting_key) DO UPDATE SET
       settings_value = EXCLUDED.settings_value,
       updated_at = NOW()`,
    [KEY, JSON.stringify(value)],
  );
}

export async function clearAiAgentConfigStore(): Promise<void> {
  await pool.query(`DELETE FROM system_settings WHERE setting_key = $1`, [KEY]);
}
