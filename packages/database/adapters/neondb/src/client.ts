// Load .env before any process.env access — NEON_DATABASE_URL must be readable before Pool is constructed.
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

// ── Driver Selection Rationale (Neon 2026 official docs) ──────────────────────
// For long-lived Node.js servers (Railway, Render, VPS, Docker), Neon recommends
// `pg` (node-postgres) with client-side connection pooling over TCP — NOT the
// @neondatabase/serverless driver. The serverless driver (HTTP/WebSocket) is
// designed for edge/serverless environments (Cloudflare Workers, Netlify, Deno)
// where TCP connections cannot persist across requests. This bot is a persistent
// Node.js process, so `pg` Pool is the correct and officially endorsed choice.
// Source: https://neon.com/docs/connect/choose-connection (Feb 2026)
// ──────────────────────────────────────────────────────────────────────────────

// Prevent connection leaks on tsx --watch hot-reloads — a globalThis singleton guard.
// Each tsx module reload would spawn a fresh Pool (and N new TCP connections) without this gate.
const globalForPool = globalThis as unknown as {
  neonPool: InstanceType<typeof Pool> | undefined;
  // Stores the initDb() Promise so any consumer can await schema readiness without re-running DDL.
  neonDbReadyPromise: Promise<void> | undefined;
};

const connectionString =
  process.env['NEON_DATABASE_URL'] ?? process.env['DATABASE_URL'];

if (!connectionString) {
  throw new Error(
    '[neondb] NEON_DATABASE_URL or DATABASE_URL environment variable is required. ' +
      'Set it to your Neon project connection string (postgres://...).',
  );
}

// Strip pg-connection-string-incompatible query parameters before handing the URL to Pool.
//
// WHY URL API instead of regex:
//   Neon's default connection string is: ...neondb?sslmode=require&channel_binding=require
//   A regex that removes "?sslmode=require" leaves "&channel_binding=require" with no leading "?".
//   pg-connection-string then reads "neondb&channel_binding=require" as the database name,
//   causing error 3D000 "database does not exist". The URL API deletes params individually
//   and re-serialises a syntactically correct URL regardless of param order or count.
//
// Params removed:
//   sslmode          — pg-connection-string v2 warns on sslmode; ssl:{} below owns TLS.
//   channel_binding  — Neon appends this in 2025+ connection strings; pg does not recognise it.
//   uselibpqcompat   — legacy compat flag not needed by node-postgres.
function normalizeConnectionString(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('sslmode');
    parsed.searchParams.delete('channel_binding');
    parsed.searchParams.delete('uselibpqcompat');
    return parsed.toString();
  } catch {
    // Fallback for connection strings that are not valid RFC-3986 URLs
    // (e.g. unix socket paths). Apply the old regex chain but also strip channel_binding.
    return url
      .replace(/[?&]sslmode=[^&]*/g, '')
      .replace(/[?&]channel_binding=[^&]*/g, '')
      .replace(/[?&]uselibpqcompat=[^&]*/g, '')
      .replace(/\?$/, '');
  }
}

const normalizedConnectionString = normalizeConnectionString(connectionString);

export const pool: InstanceType<typeof Pool> =
  globalForPool.neonPool ??
  new Pool({
    connectionString: normalizedConnectionString,
    // SSL config — two separate concerns:
    //   rejectUnauthorized: true  (prod)  — require SSL AND validate the server certificate.
    //     Neon's endpoint presents a valid CA-signed cert; validation prevents MITM on
    //     outbound connections from the bot host to Neon's servers.
    //   rejectUnauthorized: false (dev)   — require SSL (encrypted) but skip cert validation.
    //     Needed when connecting through local tunnels or with self-signed certs in dev.
    //     Note: Neon docs show `ssl: { require: true }` as a shorthand; that is equivalent
    //     to rejectUnauthorized: false (TLS on, no cert check). The prod/dev split here is
    //     intentionally more strict in production — do NOT flatten this to a single value.
    ssl:
      process.env['NODE_ENV'] === 'production'
        ? { rejectUnauthorized: true }
        : { rejectUnauthorized: false },
    // 10 connections covers a busy multi-platform bot without saturating Neon's
    // connection limits on free-tier plans (which cap at ~100 simultaneous connections).
    max: 10,
    // Keep connections alive for 55 s — longer than the heartbeat interval (45 s) so a
    // connection is never evicted between two consecutive heartbeat pings.
    // Previously 30 s, which was shorter than the recommended heartbeat cadence and caused
    // connections to go cold between beats; bumped to 55 s to eliminate that race.
    idleTimeoutMillis: 55_000,
    // Fail fast on connection timeout rather than queuing requests indefinitely.
    connectionTimeoutMillis: 10_000,
  });

if (process.env['NODE_ENV'] !== 'production') globalForPool.neonPool = pool;

// ── Connection-pool heartbeat ──────────────────────────────────────────────────
// Neon autosuspends after 5 min of inactivity on the *server* side, but the
// `pg` pool evicts idle client sockets after `idleTimeoutMillis` (55 s above).
// Without a periodic ping the pool goes cold between quiet periods, forcing a
// full TCP + TLS + auth handshake on the next command — this is the primary cause
// of first-command latency spikes.
//
// Fix: fire a no-op `SELECT 1` every 45 s (< 55 s idle timeout) to keep at
// least one client checked out and warm.  The query is negligible (sub-ms on
// Neon) and the interval is shorter than idleTimeoutMillis so connections are
// never evicted between beats.
//
// .unref() lets the Node.js event loop exit cleanly even if the interval is
// still pending — the heartbeat must never prevent graceful shutdown.
const HEARTBEAT_INTERVAL_MS = 45_000;

setInterval(() => {
  pool.query('SELECT 1').catch(() => {
    // Ignore errors — the pool will reconnect automatically on the next real query.
    // A heartbeat failure must never crash the process or surface to application code.
  });
}, HEARTBEAT_INTERVAL_MS).unref();

/** @public
 * Initialises the NeonDB schema by running all CREATE TABLE IF NOT EXISTS statements.
 * Safe to call on every application boot — the IF NOT EXISTS guard is idempotent.
 *
 * Prefer running schema.sql directly via the Neon SQL editor or psql for production deployments
 * where the application user may not hold DDL privileges.
 */
export async function initDb(): Promise<void> {
  await pool.query(`
    -- ── Better-Auth tables ──────────────────────────────────────────────────────────
    -- These are also created by 'npx @better-auth/cli migrate', but including them here
    -- ensures a single-command bootstrap path.
    -- IMPORTANT: Column names must be camelCase — better-auth uses Kysely's PostgresDialect
    -- which writes camelCase field names directly to PostgreSQL without snake_case mapping.
    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
      image TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      -- admin plugin: role controls /admin/* access; ban columns allow soft-suspension without deletion
      role TEXT,
      banned BOOLEAN DEFAULT FALSE,
      "banReason" TEXT,
      "banExpires" TIMESTAMPTZ,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "session" (
      id TEXT PRIMARY KEY,
      "expiresAt" TIMESTAMPTZ NOT NULL,
      token TEXT NOT NULL UNIQUE,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "ipAddress" TEXT,
      "userAgent" TEXT,
      -- Null for regular sessions; set to the admin's user.id only during an impersonation session
      "impersonatedBy" TEXT,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS "account" (
      id TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "providerId" TEXT NOT NULL,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "accessToken" TEXT,
      "refreshToken" TEXT,
      "idToken" TEXT,
      "accessTokenExpiresAt" TIMESTAMPTZ,
      "refreshTokenExpiresAt" TIMESTAMPTZ,
      scope TEXT,
      password TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "verification" (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      "expiresAt" TIMESTAMPTZ NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── Bot identity tables ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS bot_users (
      platform_id INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      first_name TEXT,
      username TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bot_threads (
      platform_id INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      name TEXT,
      is_group BOOLEAN NOT NULL DEFAULT FALSE,
      member_count INTEGER,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
      is_running  BOOLEAN NOT NULL DEFAULT TRUE,
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
      is_command_register  BOOLEAN NOT NULL DEFAULT FALSE,
      command_hash         TEXT,
      PRIMARY KEY (user_id, platform_id, session_id)
    );

    CREATE TABLE IF NOT EXISTS bot_credential_telegram (
      user_id              TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      platform_id          INTEGER NOT NULL,
      session_id           TEXT    NOT NULL,
      telegram_token       TEXT    NOT NULL,
      is_command_register  BOOLEAN NOT NULL DEFAULT FALSE,
      command_hash         TEXT,
      PRIMARY KEY (user_id, platform_id, session_id)
    );

    -- ── Session tracking join tables ─────────────────────────────────────────────────
    -- last_updated_at is managed explicitly (no @updatedAt equivalent in raw SQL) —
    -- upsert operations always set it to NOW() so staleness checks stay accurate.
    CREATE TABLE IF NOT EXISTS bot_users_session (
      user_id         TEXT    NOT NULL,
      platform_id     INTEGER NOT NULL,
      session_id      TEXT    NOT NULL,
      bot_user_id     TEXT    NOT NULL REFERENCES bot_users(id),
      last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      data            TEXT,
      PRIMARY KEY (user_id, platform_id, session_id, bot_user_id)
    );

    CREATE TABLE IF NOT EXISTS bot_threads_session (
      user_id         TEXT    NOT NULL,
      platform_id     INTEGER NOT NULL,
      session_id      TEXT    NOT NULL,
      bot_thread_id   TEXT    NOT NULL REFERENCES bot_threads(id),
      last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      data            TEXT,
      PRIMARY KEY (user_id, platform_id, session_id, bot_thread_id)
    );

    -- ── Command / event overrides ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS bot_session_commands (
      user_id      TEXT    NOT NULL,
      platform_id  INTEGER NOT NULL,
      session_id   TEXT    NOT NULL,
      command_name TEXT    NOT NULL,
      is_enable    BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY (user_id, platform_id, session_id, command_name)
    );

    CREATE TABLE IF NOT EXISTS bot_session_events (
      user_id     TEXT    NOT NULL,
      platform_id INTEGER NOT NULL,
      session_id  TEXT    NOT NULL,
      event_name  TEXT    NOT NULL,
      is_enable   BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY (user_id, platform_id, session_id, event_name)
    );

    -- ── Ban records ──────────────────────────────────────────────────────────────────
    -- isBanned defaults to TRUE on insert; an explicit unban sets it FALSE rather than
    -- deleting the row so the reason field is preserved for audit.
    CREATE TABLE IF NOT EXISTS bot_users_session_banned (
      user_id     TEXT    NOT NULL,
      platform_id INTEGER NOT NULL,
      session_id  TEXT    NOT NULL,
      bot_user_id TEXT    NOT NULL,
      is_banned   BOOLEAN NOT NULL DEFAULT TRUE,
      reason      TEXT,
      PRIMARY KEY (user_id, platform_id, session_id, bot_user_id)
    );

    CREATE TABLE IF NOT EXISTS bot_threads_session_banned (
      user_id       TEXT    NOT NULL,
      platform_id   INTEGER NOT NULL,
      session_id    TEXT    NOT NULL,
      bot_thread_id TEXT    NOT NULL,
      is_banned     BOOLEAN NOT NULL DEFAULT TRUE,
      reason        TEXT,
      PRIMARY KEY (user_id, platform_id, session_id, bot_thread_id)
    );

    -- ── System Admin — global platform-native admin IDs ──────────────────────────
    -- admin_id is UNIQUE so duplicate insertions are rejected at the DB level,
    -- avoiding an extra round-trip SELECT before INSERT in the repo layer.
    CREATE TABLE IF NOT EXISTS system_admin (
      id         TEXT PRIMARY KEY,
      admin_id   TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

// ── Schema readiness + connection pre-warm ────────────────────────────────────
// initDb() runs once per process and is stored so every consumer can await it before
// issuing the first query. Previously this was fire-and-forget, which caused 42P01
// (undefined_table) errors when application startup queries arrived before DDL committed.
//
// After DDL completes, a connection pre-warm fires a SELECT 1 immediately to establish
// at least one authenticated TCP connection in the pool BEFORE the first user command
// arrives. Without this, every process restart incurs a full TCP + TLS + auth handshake
// on the very first command — the main source of first-command latency spikes.
if (!globalForPool.neonDbReadyPromise) {
  globalForPool.neonDbReadyPromise = initDb()
    .then(() => {
      // Pre-warm: acquire and release one connection so the pool is not cold on the
      // first real query. Fire-and-forget — failure is silently swallowed because a
      // pre-warm error must never surface to application code or crash the process.
      pool.query('SELECT 1').catch(() => {});
    })
    .catch((err: unknown) => {
      // Non-fatal at the pool level — log clearly so absent tables surface immediately.
      console.error('[neondb] Failed to apply schema:', err);
    });
}

/** Resolves when the NeonDB schema DDL has completed. Await this before issuing any query. */
export const dbReady: Promise<void> = globalForPool.neonDbReadyPromise;
