import { tursoClient } from '../client.js';

/**
 * Maintenance Mode — a single global "on/off" flag that restricts bot usage to
 * System Admins only (mirrors "Bot Admin Only" but at the system level).
 *
 * Stored as a key/value row in the system_settings table (DDL in client.ts
 * initDb), upserted in place.
 */

const KEY = 'maintenanceModeEnabled';

export async function getMaintenanceModeEnabled(): Promise<boolean> {
  const res = await tursoClient.execute({
    sql: `SELECT settings_value FROM system_settings WHERE setting_key = :key LIMIT 1`,
    args: { key: KEY },
  });
  const row = res.rows[0] as { settings_value: string } | undefined;
  return row?.settings_value === 'true';
}

export async function setMaintenanceModeEnabled(enabled: boolean): Promise<void> {
  await tursoClient.execute({
    sql: `INSERT INTO system_settings (setting_key, settings_value, updated_at)
          VALUES (:key, :value, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT (setting_key) DO UPDATE SET
            settings_value = excluded.settings_value,
            updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    args: { key: KEY, value: enabled ? 'true' : 'false' },
  });
}