import { tursoClient } from '../client.js';

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
          : 30000,
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
  const res = await tursoClient.execute({
    sql: `SELECT settings_value FROM system_settings WHERE setting_key = :key LIMIT 1`,
    args: { key: KEY },
  });
  const row = res.rows[0] as { settings_value: string } | undefined;
  return parseValue(row?.settings_value);
}

export async function saveAiAgentConfigStore(
  value: AiAgentConfigStoreValue,
): Promise<void> {
  await tursoClient.execute({
    sql: `INSERT INTO system_settings (setting_key, settings_value, updated_at)
          VALUES (:key, :value, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT (setting_key) DO UPDATE SET
            settings_value = excluded.settings_value,
            updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    args: { key: KEY, value: JSON.stringify(value) },
  });
}

export async function clearAiAgentConfigStore(): Promise<void> {
  await tursoClient.execute({
    sql: `DELETE FROM system_settings WHERE setting_key = :key`,
    args: { key: KEY },
  });
}
