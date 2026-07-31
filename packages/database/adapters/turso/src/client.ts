// Load .env before any process.env access — TURSO_DATABASE_URL must be readable before the client is constructed.
import 'dotenv/config';
import { createClient, type Client } from '@libsql/client';

// ── Driver Selection Rationale ─────────────────────────────────────────────────
// @libsql/client is the official Turso/libSQL driver. It speaks HTTP/WebSocket
// (Hrana) to a remote Turso database (or plain SQLite semantics against a local
// file: URL), and is the same client `better-auth`'s Kysely libSQL dialect wraps
// under the hood — so a single client instance backs both raw repo queries here
// and the better-auth Kysely adapter configured in better-auth.lib.ts.
// ──────────────────────────────────────────────────────────────────────────────

// Prevent connection leaks on tsx --watch hot-reloads — a globalThis singleton guard,
// mirroring the neondb/mongodb adapters' pattern.
const globalForTurso = globalThis as unknown as {
  tursoClient: Client | undefined;
  // Stores the initDb() Promise so any consumer can await schema readiness without re-running DDL.
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

// ── Transport selection: prefer a persistent connection, but never crash the boot ──
// @libsql/client's Node entrypoint silently resolves a "libsql://" URL to its STATELESS
// HTTP (Hrana-over-HTTP) transport, not the persistent WebSocket transport the scheme
// visually implies (verified against @libsql/client@0.17.4 source: node.js's
// createClient() calls expandConfig(config, /* preferHttp */ true), which only maps
// "libsql:" -> "ws"/"wss" when preferHttp is false).
//
// Under the HTTP transport, every execute() opens a brand-new Hrana stream inside a
// brand-new HTTP request — there is no persisted connection for the heartbeat below to
// keep warm, and every command after any real idle gap pays a full new TCP+TLS handshake.
// The WebSocket transport fixes that: it keeps ONE physical connection open across calls.
//
// BUT: not every hosting environment lets outbound WebSocket upgrades through. Some
// platforms' reverse proxies reject the Upgrade request outright (observed: Replit
// returns HTTP 400 on the WS handshake to Turso, which previously took the whole process
// down with HRANA_WEBSOCKET_ERROR before this file ever got to run the schema DDL).
// A hosting-specific requirement isn't something this file can hardcode a URL rewrite
// around and trust blindly — so instead it PROBES: try the WS transport first, and if
// opening it throws (rejected upgrade, blocked port, etc.), fall back to the HTTP
// transport automatically and keep going. This is a top-level `await` — Node's ESM
// loader will not evaluate any module that imports `tursoClient` (including
// better-auth.lib.ts's `new LibsqlDialect({ client: tursoClient })`, itself evaluated at
// that module's top level) until this promise settles, so every consumer always sees
// the client that actually works, never the broken one.
//
// TURSO_FORCE_HTTP=1 skips the WS attempt entirely (e.g. to avoid the extra probe round
// trip on a host already known not to support it).
function toWebSocketUrl(rawUrl: string): string | null {
  if (!rawUrl.startsWith('libsql://')) return null;
  const authorityAndPath = rawUrl.slice('libsql://'.length);
  const tlsExplicitlyDisabled = /[?&]tls=0(&|$)/.test(rawUrl);
  return `${tlsExplicitlyDisabled ? 'ws' : 'wss'}://${authorityAndPath}`;
}

async function createTursoClient(): Promise<Client> {
  const clientOpts = authToken ? { authToken } : {};
  const wsUrl =
    process.env['TURSO_FORCE_HTTP'] === '1' ? null : toWebSocketUrl(url!);

  if (wsUrl) {
    let wsClient: Client | undefined;
    try {
      wsClient = createClient({ url: wsUrl, ...clientOpts });
      // Probe with a real round trip (with a timeout) — createClient() itself never
      // throws on a bad URL, the failure only surfaces on the first actual request.
      await Promise.race([
        wsClient.execute('SELECT 1'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('WS probe timed out')), 5_000),
        ),
      ]);
      return wsClient;
    } catch (err) {
      console.warn(
        '[turso] WebSocket transport unavailable, falling back to HTTP ' +
          '(this host likely blocks/rejects outbound WebSocket upgrades — ' +
          'set TURSO_FORCE_HTTP=1 to skip this probe on future boots):',
        err instanceof Error ? err.message : err,
      );
      try {
        wsClient?.close();
      } catch {
        // Best-effort cleanup — the connection never fully opened in most failure modes.
      }
    }
  }

  // HTTP fallback — the original, universally-compatible transport.
  return createClient({ url: url!, ...clientOpts });
}

export const tursoClient: Client =
  globalForTurso.tursoClient ?? (await createTursoClient());

if (process.env['NODE_ENV'] !== 'production')
  globalForTurso.tursoClient = tursoClient;

// ── Boolean helpers ──────────────────────────────────────────────────────────
// SQLite/libSQL has no native BOOLEAN type — columns are INTEGER 0/1. These
// helpers keep the repo layer working with real JS booleans at the call boundary,
// same as the neondb adapter's `boolean` column type does automatically via `pg`.
export const boolToInt = (value: boolean | null | undefined): number | null =>
  value === null || value === undefined ? null : value ? 1 : 0;

export const intToBool = (
  value: number | bigint | null | undefined,
): boolean => value !== null && value !== undefined && Number(value) === 1;

/** @public
 * Initialises the Turso/libSQL schema by running all CREATE TABLE IF NOT EXISTS statements.
 * Safe to call on every application boot — the IF NOT EXISTS guard is idempotent.
 *
 * Schema parity with neondb's initDb(): same tables, columns, primary keys and foreign keys,
 * translated to SQLite/libSQL syntax — TEXT/INTEGER in place of TIMESTAMPTZ/BOOLEAN.
 */
export async function initDb(): Promise<void> {
  // Enforce ON DELETE CASCADE — SQLite disables FK enforcement by default per-connection.
  await tursoClient.execute('PRAGMA foreign_keys = ON;');

  await tursoClient.executeMultiple(`
    -- ── Better-Auth tables ──────────────────────────────────────────────────────────
    -- These are also created by 'npx @better-auth/cli migrate', but including them here
    -- ensures a single-command bootstrap path.
    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      createdAt TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      -- admin plugin: role controls /admin/* access; ban columns allow soft-suspension without deletion
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
      -- Null for regular sessions; set to the admin's user.id only during an impersonation session
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

    -- ── Bot identity tables ──────────────────────────────────────────────────────────
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

    -- M:M junction tables, defined explicitly
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

    -- ── Discord Server & Channel mappings ────────────────────────────────────────────
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

    -- ── Session-level config ─────────────────────────────────────────────────────────
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

    -- ── Bot Premium — same structure as bot_admin; grants ANYONE+THREAD_ADMIN+PREMIUM ──
    CREATE TABLE IF NOT EXISTS bot_premium (
      user_id     TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      platform_id INTEGER NOT NULL,
      session_id  TEXT    NOT NULL,
      premium_id  TEXT    NOT NULL,
      PRIMARY KEY (user_id, platform_id, session_id, premium_id)
    );

    -- ── Platform credentials ─────────────────────────────────────────────────────────
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

    -- ── Session tracking join tables ─────────────────────────────────────────────────
    -- last_updated_at is managed explicitly (no @updatedAt equivalent in raw SQL) —
    -- upsert operations always set it to the current timestamp so staleness checks stay accurate.
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

    -- ── Command / event overrides ────────────────────────────────────────────────────
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

    -- ── Ban records ──────────────────────────────────────────────────────────────────
    -- isBanned defaults to TRUE(1) on insert; an explicit unban sets it 0 rather than
    -- deleting the row so the reason field is preserved for audit.
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

    -- ── System Admin — global platform-native admin IDs ──────────────────────────
    -- admin_id is UNIQUE so duplicate insertions are rejected at the DB level,
    -- avoiding an extra round-trip SELECT before INSERT in the repo layer.
    CREATE TABLE IF NOT EXISTS system_admin (
      id         TEXT PRIMARY KEY,
      admin_id   TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
}

// ── Schema readiness ────────────────────────────────────────────────────────
// initDb() runs once per process and is stored so every consumer can await it before
// issuing the first query — mirrors the neondb adapter's readiness-gating pattern.
if (!globalForTurso.tursoDbReadyPromise) {
  globalForTurso.tursoDbReadyPromise = initDb().catch((err: unknown) => {
    // Non-fatal at the client level — log clearly so absent tables surface immediately.
    console.error('[turso] Failed to apply schema:', err);
  });
}

/** Resolves when the Turso/libSQL schema DDL has completed. Await this before issuing any query. */
export const dbReady: Promise<void> = globalForTurso.tursoDbReadyPromise;

// ── Connection heartbeat ─────────────────────────────────────────────────────
// Now that the client above is forced onto the persistent WebSocket transport (see
// toPersistentUrl), this heartbeat actually has a live connection to keep warm — on the
// default HTTP transport it was a no-op, since each execute() opened and closed its own
// one-shot HTTP request with nothing left behind to preserve between beats.
//
// Remote Turso databases can still idle out the WS connection at the platform or network
// layer during quiet periods (and the WS client itself proactively recycles the
// connection every 60 s — see maxConnAgeMillis in @libsql/client — but only from inside
// an execute() call, so something has to keep calling it). Without a periodic ping, the
// next real command after inactivity pays a full reconnect (TCP/TLS + Hrana handshake) on
// top of its own query, spiking first-command latency.
//
// A trivial `SELECT 1` every 45 s (comfortably under the 60 s recycle window) keeps the
// underlying WebSocket session warm. Harmless no-op for local `file:` URLs — negligible
// cost either way. .unref() so the heartbeat never blocks graceful process shutdown.
const HEARTBEAT_INTERVAL_MS = 45_000;

// Fire one immediately (rather than waiting for the first 45 s tick) so the connection
// is already warm by the time the first real command lands — matters most right after a
// fresh boot or restart, which is exactly when dbReady's own DDL round trip already
// warmed it once, but doing it explicitly here keeps this file correct even if initDb()
// is ever changed to skip its own round trip (e.g. an empty/no-op schema in the future).
tursoClient.execute('SELECT 1').catch(() => {
  // Ignore errors — the client reconnects automatically on the next real query.
});

setInterval(() => {
  tursoClient.execute('SELECT 1').catch(() => {
    // Ignore errors — the client reconnects automatically on the next real query.
    // A heartbeat failure must never crash the process or surface to application code.
  });
}, HEARTBEAT_INTERVAL_MS).unref();