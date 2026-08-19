import { tursoClient } from '../client.js';

/**
 * Global GitHub Config Store — the single deployment-level GitHub token.
 *
 * All GitHub authentication (bot commands /push, /installer, /update, the
 * admin_commit_push agent tool, and the Admin File Manager Git tab) uses ONE
 * token, set through the dashboard's Git tab. Stored as a JSON blob in the
 * system_settings table (DDL in client.ts initDb) under the `githubConfig` key,
 * upserted in place. The token itself is encrypted (AES-256-GCM, enc:v1:) by
 * the cat-bot layer before it reaches this store — the adapter is
 * encryption-agnostic and simply persists the JSON value.
 */

export interface GitHubConfigStoreValue {
  /** AES-256-GCM encrypted classic GitHub PAT (enc:v1:…). */
  encryptedToken: string;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  updatedAt: string;
}

const KEY = 'githubConfig';

function parseValue(raw: string | undefined | null): GitHubConfigStoreValue | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GitHubConfigStoreValue>;
    if (
      typeof parsed.encryptedToken !== 'string' ||
      parsed.encryptedToken === '' ||
      typeof parsed.login !== 'string'
    ) {
      return null;
    }
    return {
      encryptedToken: parsed.encryptedToken,
      login: parsed.login,
      name: typeof parsed.name === 'string' ? parsed.name : null,
      email: typeof parsed.email === 'string' ? parsed.email : null,
      avatarUrl: typeof parsed.avatarUrl === 'string' ? parsed.avatarUrl : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return null;
  }
}

export async function getGitHubConfigStore(): Promise<GitHubConfigStoreValue | null> {
  const res = await tursoClient.execute({
    sql: `SELECT settings_value FROM system_settings WHERE setting_key = :key LIMIT 1`,
    args: { key: KEY },
  });
  const row = res.rows[0] as { settings_value: string } | undefined;
  return parseValue(row?.settings_value);
}

export async function saveGitHubConfigStore(value: GitHubConfigStoreValue): Promise<void> {
  await tursoClient.execute({
    sql: `INSERT INTO system_settings (setting_key, settings_value, updated_at)
          VALUES (:key, :value, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT (setting_key) DO UPDATE SET
            settings_value = excluded.settings_value,
            updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    args: { key: KEY, value: JSON.stringify(value) },
  });
}

export async function clearGitHubConfigStore(): Promise<void> {
  await tursoClient.execute({
    sql: `DELETE FROM system_settings WHERE setting_key = :key`,
    args: { key: KEY },
  });
}