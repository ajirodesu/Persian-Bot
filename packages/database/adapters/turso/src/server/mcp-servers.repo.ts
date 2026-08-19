import { tursoClient } from '../client.js';

/**
 * MCP Servers Store — the deployment-level custom MCP server registry.
 *
 * System administrators add custom MCP servers (name + URL + optional auth
 * headers) in the Admin dashboard → MCP Servers page. The AI agent loads these
 * from the database on every turn, connects to each enabled server over MCP
 * Streamable HTTP, and exposes its tools to the LLM.
 *
 * Stored as a JSON blob in the system_settings table (DDL in client.ts initDb)
 * under the `mcpServers` key, upserted in place. Header values are encrypted
 * (AES-256-GCM, enc:v1:) by the cat-bot layer before they reach this store —
 * the adapter is encryption-agnostic and simply persists the JSON value.
 */

export interface McpServerRecord {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  /** AES-256-GCM encrypted JSON of the request headers (enc:v1:…) — may be absent. */
  headersEncrypted?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerStore {
  servers: McpServerRecord[];
}

const KEY = 'mcpServers';

function parseStore(raw: string | undefined | null): McpServerStore | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<McpServerStore>;
    if (!Array.isArray(parsed.servers)) return null;
    const servers = parsed.servers.filter(
      (s) =>
        s &&
        typeof s.id === 'string' &&
        s.id !== '' &&
        typeof s.name === 'string' &&
        typeof s.url === 'string',
    );
    return { servers };
  } catch {
    return null;
  }
}

export async function getMcpServersStore(): Promise<McpServerStore | null> {
  const res = await tursoClient.execute({
    sql: `SELECT settings_value FROM system_settings WHERE setting_key = :key LIMIT 1`,
    args: { key: KEY },
  });
  const row = res.rows[0] as { settings_value: string } | undefined;
  return parseStore(row?.settings_value);
}

export async function saveMcpServersStore(value: McpServerStore): Promise<void> {
  await tursoClient.execute({
    sql: `INSERT INTO system_settings (setting_key, settings_value, updated_at)
          VALUES (:key, :value, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT (setting_key) DO UPDATE SET
            settings_value = excluded.settings_value,
            updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    args: { key: KEY, value: JSON.stringify(value) },
  });
}