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

/** The providers the unified bot_user_ai_config schema stores columns for. */
const AI_CONFIG_PROVIDERS = new Set([
  'openrouter',
  'groq',
  'nvidia',
  'openai',
  'gemini',
  'zen',
]);

function isSupportedAiProvider(value: string): boolean {
  return AI_CONFIG_PROVIDERS.has(value);
}

/** Parses the agent_settings JSON text — never throws, always an object. */
function parseAgentSettingsJson(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to {}.
  }
  return {};
}

/** Idempotent schema bootstrap. Safe to call on every boot. */
export async function initDb(): Promise<void> {
  await tursoClient.execute('PRAGMA foreign_keys = ON;');

  // Fast-path: if the last table in the DDL already exists the schema is fully
  // applied. Skip the entire DDL block — saves one extra Turso round-trip on
  // every restart when the database is already initialised.
  const schemaCheck = await tursoClient.execute(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name='system_admin' LIMIT 1`,
  );

  // bot_user_ai_config — idempotent table that must exist even when the
  // fast-path above returns early (already-initialised databases would otherwise
  // never receive new tables that are added after their initial bootstrap). Run
  // unconditionally before the guard.
  //
  // Holds the per-user AI provider config with a dedicated key/hint/model column
  // pair for EVERY provider (openrouter, groq, nvidia, openai, gemini), the
  // active provider, and the per-user agent behavior blob. Renamed from
  // bot_user_groq_key so no provider is implied to be primary. New columns are
  // nullable so pre-existing rows stay insertable.
  await tursoClient.execute(`
    CREATE TABLE IF NOT EXISTS bot_user_ai_config (
      user_id                  TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      openrouter_encrypted_key TEXT,
      openrouter_key_hint      TEXT,
      openrouter_model         TEXT,
      groq_encrypted_key       TEXT,
      groq_key_hint            TEXT,
      groq_model               TEXT,
      nvidia_encrypted_key     TEXT,
      nvidia_key_hint          TEXT,
      nvidia_model             TEXT,
      openai_encrypted_key     TEXT,
      openai_key_hint          TEXT,
      openai_model             TEXT,
      gemini_encrypted_key     TEXT,
      gemini_key_hint          TEXT,
      gemini_model             TEXT,
      zen_encrypted_key        TEXT,
      zen_key_hint             TEXT,
      zen_model                TEXT,
      provider                 TEXT DEFAULT 'openrouter',
      agent_settings           TEXT,
      created_at               TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at               TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
  // Idempotent column upgrade for pre-existing databases that predate the
  // unified multi-provider schema — same PRAGMA introspection + ALTER TABLE ADD
  // COLUMN pattern as bot_discord_channel below (SQLite has no ADD COLUMN IF
  // NOT EXISTS).
  const aiConfigCols = await tursoClient.execute(
    `PRAGMA table_info(bot_user_ai_config)`,
  );
  const aiConfigColNames = new Set(
    (aiConfigCols.rows as unknown as Array<{ name: string }>).map((r) => r.name),
  );
  const aiConfigNewCols: Array<[string, string]> = [
    ['openrouter_encrypted_key', 'TEXT'],
    ['openrouter_key_hint', 'TEXT'],
    ['openrouter_model', 'TEXT'],
    ['groq_encrypted_key', 'TEXT'],
    ['groq_key_hint', 'TEXT'],
    ['groq_model', 'TEXT'],
    ['nvidia_encrypted_key', 'TEXT'],
    ['nvidia_key_hint', 'TEXT'],
    ['nvidia_model', 'TEXT'],
    ['openai_encrypted_key', 'TEXT'],
    ['openai_key_hint', 'TEXT'],
    ['openai_model', 'TEXT'],
    ['gemini_encrypted_key', 'TEXT'],
    ['gemini_key_hint', 'TEXT'],
    ['gemini_model', 'TEXT'],
    ['zen_encrypted_key', 'TEXT'],
    ['zen_key_hint', 'TEXT'],
    ['zen_model', 'TEXT'],
    ['provider', "TEXT DEFAULT 'openrouter'"],
    // Per-user AI agent settings blob (JSON text): trigger word, behavior
    // toggles/limits. Provider keys/models all live in their own columns now.
    ['agent_settings', 'TEXT'],
  ];
  for (const [colName, colDef] of aiConfigNewCols) {
    if (!aiConfigColNames.has(colName)) {
      await tursoClient.execute({
        sql: `ALTER TABLE bot_user_ai_config ADD COLUMN ${colName} ${colDef}`,
      });
    }
  }

  // One-time migration from the legacy bot_user_groq_key table (predates the
  // multi-provider feature). Copies groq (encrypted_key/key_hint), openrouter
  // and nvidia columns verbatim, promotes the openai/gemini key+model slots out
  // of the agent_settings blob into their own columns, and folds the blob's
  // activeProvider into the provider column. INSERT OR IGNORE + a final orphan
  // check make the copy idempotent and safe to retry; the legacy table is
  // dropped only once every row has been copied.
  const legacyAiTable = await tursoClient.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='bot_user_groq_key'`,
  );
  if (legacyAiTable.rows.length > 0) {
    const legacyAiRows = await tursoClient.execute(
      `SELECT user_id, encrypted_key, key_hint, openrouter_encrypted_key,
              openrouter_key_hint, nvidia_encrypted_key, nvidia_key_hint,
              provider, groq_model, openrouter_model, nvidia_model,
              agent_settings, created_at, updated_at
       FROM bot_user_groq_key`,
    );
    const nowIso = () => new Date().toISOString();
    for (const row of legacyAiRows.rows as Array<Record<string, unknown>>) {
      const blob = parseAgentSettingsJson(String(row['agent_settings'] ?? ''));
      const legacyProvider = row['provider'];
      const blobProvider = blob['activeProvider'];
      const provider =
        typeof blobProvider === 'string' &&
        isSupportedAiProvider(blobProvider) &&
        String(blob[`${blobProvider}EncryptedKey`] ?? '').length > 0
          ? blobProvider
          : typeof legacyProvider === 'string' &&
              isSupportedAiProvider(legacyProvider)
            ? legacyProvider
            : 'openrouter';
      // Strip the provider slots out of the blob — agent behavior stays.
      const cleanBlob: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(blob)) {
        if (
          k === 'activeProvider' ||
          /^(openai|gemini)(EncryptedKey|KeyHint|Model)$/.test(k)
        ) {
          continue;
        }
        cleanBlob[k] = v;
      }
      await tursoClient.execute({
        sql: `INSERT OR IGNORE INTO bot_user_ai_config
                (user_id, openrouter_encrypted_key, openrouter_key_hint,
                 openrouter_model, groq_encrypted_key, groq_key_hint,
                 groq_model, nvidia_encrypted_key, nvidia_key_hint,
                 nvidia_model, openai_encrypted_key, openai_key_hint,
                 openai_model, gemini_encrypted_key, gemini_key_hint,
                 gemini_model, provider, agent_settings, created_at, updated_at)
              VALUES (:userId, :orKey, :orHint, :orModel, :gKey, :gHint,
                      :gModel, :nvKey, :nvHint, :nvModel, :oaKey, :oaHint,
                      :oaModel, :gmKey, :gmHint, :gmModel, :provider,
                      :settings, :createdAt, :updatedAt)`,
        args: {
          userId: String(row['user_id']),
          orKey: String(row['openrouter_encrypted_key'] ?? ''),
          orHint: String(row['openrouter_key_hint'] ?? ''),
          orModel: String(row['openrouter_model'] ?? ''),
          gKey: String(row['encrypted_key'] ?? ''),
          gHint: String(row['key_hint'] ?? ''),
          gModel: String(row['groq_model'] ?? ''),
          nvKey: String(row['nvidia_encrypted_key'] ?? ''),
          nvHint: String(row['nvidia_key_hint'] ?? ''),
          nvModel: String(row['nvidia_model'] ?? ''),
          oaKey: String(blob['openaiEncryptedKey'] ?? ''),
          oaHint: String(blob['openaiKeyHint'] ?? ''),
          oaModel: String(blob['openaiModel'] ?? ''),
          gmKey: String(blob['geminiEncryptedKey'] ?? ''),
          gmHint: String(blob['geminiKeyHint'] ?? ''),
          gmModel: String(blob['geminiModel'] ?? ''),
          provider,
          settings: JSON.stringify(cleanBlob),
          createdAt: String(row['created_at'] ?? nowIso()),
          updatedAt: String(row['updated_at'] ?? nowIso()),
        },
      });
    }
    // Drop the legacy table only once every row has been copied.
    const orphanedAiRows = await tursoClient.execute(
      `SELECT COUNT(*) AS cnt FROM bot_user_groq_key L
       WHERE NOT EXISTS (
         SELECT 1 FROM bot_user_ai_config N WHERE N.user_id = L.user_id
       )`,
    );
    const orphanCount = Number(
      (orphanedAiRows.rows[0] as unknown as { cnt: number }).cnt,
    );
    if (orphanCount === 0) {
      await tursoClient.execute(`DROP TABLE IF EXISTS bot_user_groq_key`);
    }
  }

  // Per-user dashboard timezone preference (IANA identifier, e.g. "Asia/Manila").
  // Same idempotent-outside-the-fast-path pattern as bot_user_groq_key above, so
  // already-initialised databases pick up this table without a manual migration.
  await tursoClient.execute(`
    CREATE TABLE IF NOT EXISTS bot_user_timezone (
      user_id     TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      timezone    TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  // Global maintenance-mode switch — single key/value row (see maintenance-mode.repo.ts).
  // Same idempotent-outside-the-fast-path pattern, so already-initialised
  // databases pick it up without a manual migration.
  await tursoClient.execute(`
    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key     TEXT PRIMARY KEY,
      settings_value  TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at      TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  // Discord channel identity (name/type) — same idempotent-outside-the-fast-path
  // pattern as the tables above so already-initialised databases receive the new
  // columns without a manual migration. Fresh databases get them from the
  // CREATE TABLE below; pre-existing tables are upgraded in place with a PRAGMA
  // introspection + ALTER TABLE ADD COLUMN (SQLite has no ADD COLUMN IF NOT EXISTS).
  await tursoClient.execute(`
    CREATE TABLE IF NOT EXISTS bot_discord_channel (
      thread_id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES bot_discord_server(id) ON DELETE CASCADE,
      name      TEXT,
      type      TEXT
    );
  `);
  const channelCols = await tursoClient.execute(
    `PRAGMA table_info(bot_discord_channel)`,
  );
  const channelColNames = new Set(
    (channelCols.rows as unknown as Array<{ name: string }>).map((r) => r.name),
  );
  if (!channelColNames.has('name')) {
    await tursoClient.execute({
      sql: `ALTER TABLE bot_discord_channel ADD COLUMN name TEXT`,
    });
  }
  if (!channelColNames.has('type')) {
    await tursoClient.execute({
      sql: `ALTER TABLE bot_discord_channel ADD COLUMN type TEXT`,
    });
  }

  // bot_threads — same idempotent-outside-the-fast-path pattern as
  // bot_credential_fluxer above. This table lived only inside the guarded DDL
  // block, so databases initialised before it was added would early-return and
  // never receive it — and the PRAGMA introspection below would then throw
  // "no such table: bot_threads" on the remote Turso API, aborting the entire
  // schema init (and leaving every later table missing). Create it
  // unconditionally so every database converges on the full schema.
  await tursoClient.execute(`
    CREATE TABLE IF NOT EXISTS bot_threads (
      platform_id INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      name TEXT,
      is_group INTEGER NOT NULL DEFAULT 0,
      type TEXT,
      member_count INTEGER,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
  // bot_threads.type — idempotent column upgrade for pre-existing databases that
  // predate per-platform chat-type detection. Same PRAGMA introspection + ALTER
  // TABLE ADD COLUMN pattern as bot_discord_channel above (SQLite has no
  // ADD COLUMN IF NOT EXISTS).
  const threadCols = await tursoClient.execute(
    `PRAGMA table_info(bot_threads)`,
  );
  const threadColNames = new Set(
    (threadCols.rows as unknown as Array<{ name: string }>).map((r) => r.name),
  );
  if (!threadColNames.has('type')) {
    await tursoClient.execute({
      sql: `ALTER TABLE bot_threads ADD COLUMN type TEXT`,
    });
  }

  // bot_credential_fluxer — same idempotent-outside-the-fast-path pattern as
  // bot_user_groq_key above, so already-initialised databases pick up the Fluxer
  // credential table without a manual migration. Created unconditionally so every
  // database converges on the full schema regardless of when it was bootstrapped.
  await tursoClient.execute(`
    CREATE TABLE IF NOT EXISTS bot_credential_fluxer (
      user_id      TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      platform_id  INTEGER NOT NULL,
      session_id   TEXT    NOT NULL,
      fluxer_token TEXT    NOT NULL,
      PRIMARY KEY (user_id, platform_id, session_id)
    );
  `);

  // bot_credential_discord / bot_credential_telegram — same
  // idempotent-outside-the-fast-path pattern as bot_credential_fluxer above.
  // These existed only inside the guarded DDL block, so databases initialised
  // before they were added would early-return and never receive the tables —
  // causing "no such table: bot_credential_discord" on boot. Create them
  // unconditionally so every database converges on the full schema.
  await tursoClient.execute(`
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
  `);
  await tursoClient.execute(`
    CREATE TABLE IF NOT EXISTS bot_credential_telegram (
      user_id              TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      platform_id          INTEGER NOT NULL,
      session_id           TEXT    NOT NULL,
      telegram_token       TEXT    NOT NULL,
      is_command_register  INTEGER NOT NULL DEFAULT 0,
      command_hash         TEXT,
      PRIMARY KEY (user_id, platform_id, session_id)
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
      server_id TEXT NOT NULL REFERENCES bot_discord_server(id) ON DELETE CASCADE,
      name      TEXT,
      type      TEXT
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

    -- Discord server bans are keyed by server id (not channel) so a ban covers
    -- every channel in the guild. Mirrors bot_threads_session_banned's audit style:
    -- is_banned defaults to 1, an explicit unban sets it 0 and keeps the reason row.
    CREATE TABLE IF NOT EXISTS bot_discord_server_session_banned (
      user_id       TEXT    NOT NULL,
      session_id    TEXT    NOT NULL,
      bot_server_id TEXT    NOT NULL,
      is_banned     INTEGER NOT NULL DEFAULT 1,
      reason        TEXT,
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
