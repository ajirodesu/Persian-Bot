import 'dotenv/config';
import { createClient, type Client } from '@libsql/client';

// Singleton guard — prevents duplicate clients during tsx --watch hot-reloads.
const globalForTurso = globalThis as unknown as {
  tursoClient: Client | undefined;
  tursoDbReadyPromise: Promise<void> | undefined;
};

const url = process.env['TURSO_DATABASE_URL'];
const authToken = process.env['TURSO_AUTH_TOKEN'];

if (!url) {
  throw new Error(
    '[turso] TURSO_DATABASE_URL environment variable is required. ' +
      'Set it to your Turso database URL (libsql://... or file:...).',
  );
}

// Convert a libsql:// URL to wss:// for the persistent WebSocket transport.
// Returns null for any other scheme (file:, https:, etc.).
function toWebSocketUrl(rawUrl: string): string | null {
  if (!rawUrl.startsWith('libsql://')) return null;
  const authorityAndPath = rawUrl.slice('libsql://'.length);
  const tlsExplicitlyDisabled = /[?&]tls=0(&|$)/.test(rawUrl);
  return `${tlsExplicitlyDisabled ? 'ws' : 'wss'}://${authorityAndPath}`;
}

// Try the persistent WebSocket transport first; fall back to HTTP if the host
// blocks outbound WebSocket upgrades. Set TURSO_FORCE_HTTP=1 to skip the probe.
// Once resolved, the result is written to TURSO_TRANSPORT so subsequent process
// restarts (same machine) skip the probe entirely and connect immediately.
async function createTursoClient(): Promise<Client> {
  const clientOpts = authToken ? { authToken } : {};

  // Honour an explicit override from a previous successful probe (or manual config).
  const resolved = process.env['TURSO_TRANSPORT'];
  const forceHttp = process.env['TURSO_FORCE_HTTP'] === '1' || resolved === 'http';
  const wsUrl = forceHttp ? null : toWebSocketUrl(url!);

  if (wsUrl) {
    let wsClient: Client | undefined;
    try {
      wsClient = createClient({ url: wsUrl, ...clientOpts });
      // 500 ms timeout — if WS isn't ready quickly it likely won't be reliable;
      // falling back to HTTP is faster than waiting out a stalled handshake.
      await Promise.race([
        wsClient.execute('SELECT 1'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('WS probe timed out')), 500),
        ),
      ]);
      // Cache the successful transport so future restarts skip the probe.
      process.env['TURSO_TRANSPORT'] = 'ws';
      return wsClient;
    } catch (err) {
      console.warn(
        '[turso] WebSocket transport unavailable, falling back to HTTP ' +
          '(set TURSO_FORCE_HTTP=1 to skip this probe on future boots):',
        err instanceof Error ? err.message : err,
      );
      try { wsClient?.close(); } catch { /* best-effort */ }
      process.env['TURSO_TRANSPORT'] = 'http';
    }
  }

  return createClient({ url: url!, ...clientOpts });
}

export const tursoClient: Client =
  globalForTurso.tursoClient ?? (await createTursoClient());

if (process.env['NODE_ENV'] !== 'production')
  globalForTurso.tursoClient = tursoClient;

// SQLite has no native BOOLEAN — columns are INTEGER 0/1.
export const boolToInt = (value: boolean | null | undefined): number | null =>
  value === null || value === undefined ? null : value ? 1 : 0;

export const intToBool = (
  value: number | bigint | null | undefined,
): boolean => value !== null && value !== undefined && Number(value) === 1;

/** Idempotent schema bootstrap. Safe to call on every boot. */
export async function initDb(): Promise<void> {
  await tursoClient.execute('PRAGMA foreign_keys = ON;');

  // Fast-path: if the last table in the DDL already exists the schema is fully
  // applied. Skip the entire DDL block — saves one extra Turso round-trip on
  // every restart when the database is already initialised.
  const schemaCheck = await tursoClient.execute(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name='system_admin' LIMIT 1`,
  );

  // Idempotent table that must exist even when the fast-path above returns early
  // (already-initialised databases would otherwise never receive new tables that
  // are added after their initial bootstrap). Run unconditionally before the guard.
  await tursoClient.execute(`
    CREATE TABLE IF NOT EXISTS bot_user_groq_key (
      user_id       TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      encrypted_key TEXT NOT NULL,
      key_hint      TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at    TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  if (schemaCheck.rows.length > 0) return;

  await tursoClient.executeMultiple(`
    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      createdAt TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      role TEXT,
      banned INTEGER DEFAULT 0,
      banReason TEXT,
      banExpires TEXT,
      updatedAt TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS "session" (
      id TEXT PRIMARY KEY,
      expiresAt TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      createdAt TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updatedAt TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      ipAddress TEXT,
      userAgent TEXT,
      impersonatedBy TEXT,
      userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS "account" (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      providerId TEXT NOT NULL,
      userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      accessToken TEXT,
      refreshToken TEXT,
      idToken TEXT,
      accessTokenExpiresAt TEXT,
      refreshTokenExpiresAt TEXT,
      scope TEXT,
      password TEXT,
      createdAt TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updatedAt TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS "verification" (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updatedAt TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS bot_users (
      platform_id INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      first_name TEXT,
      username TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS bot_threads (
      platform_id INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      name TEXT,
      is_group INTEGER NOT NULL DEFAULT 0,
      member_count INTEGER,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS bot_thread_participants (
      thread_id TEXT NOT NULL REFERENCES bot_threads(id) ON DELETE CASCADE,
      user_id   TEXT NOT NULL REFERENCES bot_users(id)   ON DELETE CASCADE,
      PRIMARY KEY (thread_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS bot_thread_admins (
      thread_id TEXT NOT NULL REFERENCES bot_threads(id) ON DELETE CASCADE,
      user_id   TEXT NOT NULL REFERENCES bot_users(id)   ON DELETE CASCADE,
      PRIMARY KEY (thread_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS bot_discord_server (
      id           TEXT PRIMARY KEY,
      name         TEXT,
      avatar_url   TEXT,
      member_count INTEGER,
      created_at   TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at   TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS bot_discord_channel (
      thread_id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES bot_discord_server(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bot_discord_server_participants (
      server_id TEXT NOT NULL REFERENCES bot_discord_server(id) ON DELETE CASCADE,
      user_id   TEXT NOT NULL REFERENCES bot_users(id) ON DELETE CASCADE,
      PRIMARY KEY (server_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS bot_discord_server_admins (
      server_id TEXT NOT NULL REFERENCES bot_discord_server(id) ON DELETE CASCADE,
      user_id   TEXT NOT NULL REFERENCES bot_users(id) ON DELETE CASCADE,
      PRIMARY KEY (server_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS bot_discord_server_session (
      user_id         TEXT NOT NULL,
      session_id      TEXT NOT NULL,
      bot_server_id   TEXT NOT NULL REFERENCES bot_discord_server(id) ON DELETE CASCADE,
      last_updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      data            TEXT,
      PRIMARY KEY (user_id, session_id, bot_server_id)
    );

    CREATE TABLE IF NOT EXISTS bot_session (
      user_id     TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      platform_id INTEGER NOT NULL,
      session_id  TEXT    NOT NULL,
      nickname    TEXT,
      prefix      TEXT,
      is_running  INTEGER NOT NULL DEFAULT 1,
      data        TEXT,
      PRIMARY KEY (user_id, platform_id, session_id)
    );

    CREATE TABLE IF NOT EXISTS bot_admin (
      user_id     TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      platform_id INTEGER NOT NULL,
      session_id  TEXT    NOT NULL,
      admin_id    TEXT    NOT NULL,
      PRIMARY KEY (user_id, platform_id, session_id, admin_id)
    );

    CREATE TABLE IF NOT EXISTS bot_premium (
      user_id     TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      platform_id INTEGER NOT NULL,
      session_id  TEXT    NOT NULL,
      premium_id  TEXT    NOT NULL,
      PRIMARY KEY (user_id, platform_id, session_id, premium_id)
    );

    CREATE TABLE IF NOT EXISTS bot_credential_discord (
      user_id              TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      platform_id          INTEGER NOT NULL,
      session_id           TEXT    NOT NULL,
      discord_token        TEXT    NOT NULL,
      discord_client_id    TEXT    NOT NULL,
      is_command_register  INTEGER NOT NULL DEFAULT 0,
      command_hash         TEXT,
      PRIMARY KEY (user_id, platform_id, session_id)
    );

    CREATE TABLE IF NOT EXISTS bot_credential_telegram (
      user_id              TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      platform_id          INTEGER NOT NULL,
      session_id           TEXT    NOT NULL,
      telegram_token       TEXT    NOT NULL,
      is_command_register  INTEGER NOT NULL DEFAULT 0,
      command_hash         TEXT,
      PRIMARY KEY (user_id, platform_id, session_id)
    );

    CREATE TABLE IF NOT EXISTS bot_users_session (
      user_id         TEXT    NOT NULL,
      platform_id     INTEGER NOT NULL,
      session_id      TEXT    NOT NULL,
      bot_user_id     TEXT    NOT NULL REFERENCES bot_users(id),
      last_updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      data            TEXT,
      PRIMARY KEY (user_id, platform_id, session_id, bot_user_id)
    );

    CREATE TABLE IF NOT EXISTS bot_threads_session (
      user_id         TEXT    NOT NULL,
      platform_id     INTEGER NOT NULL,
      session_id      TEXT    NOT NULL,
      bot_thread_id   TEXT    NOT NULL REFERENCES bot_threads(id),
      last_updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      data            TEXT,
      PRIMARY KEY (user_id, platform_id, session_id, bot_thread_id)
    );

    CREATE TABLE IF NOT EXISTS bot_session_commands (
      user_id      TEXT    NOT NULL,
      platform_id  INTEGER NOT NULL,
      session_id   TEXT    NOT NULL,
      command_name TEXT    NOT NULL,
      is_enable    INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, platform_id, session_id, command_name)
    );

    CREATE TABLE IF NOT EXISTS bot_session_events (
      user_id     TEXT    NOT NULL,
      platform_id INTEGER NOT NULL,
      session_id  TEXT    NOT NULL,
      event_name  TEXT    NOT NULL,
      is_enable   INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, platform_id, session_id, event_name)
    );

    -- isBanned defaults to 1 on insert; explicit unban sets it 0 (row kept for audit).
    CREATE TABLE IF NOT EXISTS bot_users_session_banned (
      user_id     TEXT    NOT NULL,
      platform_id INTEGER NOT NULL,
      session_id  TEXT    NOT NULL,
      bot_user_id TEXT    NOT NULL,
      is_banned   INTEGER NOT NULL DEFAULT 1,
      reason      TEXT,
      PRIMARY KEY (user_id, platform_id, session_id, bot_user_id)
    );

    CREATE TABLE IF NOT EXISTS bot_threads_session_banned (
      user_id       TEXT    NOT NULL,
      platform_id   INTEGER NOT NULL,
      session_id    TEXT    NOT NULL,
      bot_thread_id TEXT    NOT NULL,
      is_banned     INTEGER NOT NULL DEFAULT 1,
      reason        TEXT,
      PRIMARY KEY (user_id, platform_id, session_id, bot_thread_id)
    );

    -- UNIQUE on admin_id rejects duplicates at the DB level without an extra SELECT.
    CREATE TABLE IF NOT EXISTS system_admin (
      id         TEXT PRIMARY KEY,
      admin_id   TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
}

// Run schema DDL once per process; stored so any consumer can await readiness.
if (!globalForTurso.tursoDbReadyPromise) {
  globalForTurso.tursoDbReadyPromise = initDb().catch((err: unknown) => {
    console.error('[turso] Failed to apply schema:', err);
  });
}

/** Resolves when schema DDL has completed. Await before issuing the first query. */
export const dbReady: Promise<void> = globalForTurso.tursoDbReadyPromise;

// Keep the connection pool warm.
// - HTTP transport: undici idle-socket window is 4–10 s; 8 s ensures every real
//   query lands on an open socket.
// - WS transport: the libsql client sends its own ping/pong frames; 25 s is ample.
// .unref() so the interval never blocks graceful shutdown.
const HEARTBEAT_INTERVAL_MS =
  process.env['TURSO_TRANSPORT'] === 'ws' ? 25_000 : 8_000;

tursoClient.execute('SELECT 1').catch(() => { /* reconnects automatically */ });

setInterval(() => {
  tursoClient.execute('SELECT 1').catch(() => { /* reconnects automatically */ });
}, HEARTBEAT_INTERVAL_MS).unref();
