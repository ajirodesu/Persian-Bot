import { pool } from '../client.js';

/**
 * Maintenance Mode — a single global "on/off" flag that restricts bot usage to
 * System Admins only (mirrors "Bot Admin Only" but at the system level).
 *
 * Stored as a key/value row in the system_settings table (DDL in client.ts
 * initDb), upserted in place.
 */

const KEY = 'maintenanceModeEnabled';

export async function getMaintenanceModeEnabled(): Promise<boolean> {
  const res = await pool.query<{ settings_value: string }>(
    `SELECT settings_value FROM system_settings WHERE setting_key = $1 LIMIT 1`,
    [KEY],
  );
  return res.rows[0]?.settings_value === 'true';
}

export async function setMaintenanceModeEnabled(enabled: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (setting_key, settings_value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (setting_key) DO UPDATE SET
       settings_value = EXCLUDED.settings_value,
       updated_at = NOW()`,
    [KEY, enabled ? 'true' : 'false'],
  );
}