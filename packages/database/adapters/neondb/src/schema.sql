-- ============================================================================
-- NeonDB Schema — Cat-Bot
-- Run this file once against your Neon project via the SQL editor or psql.
-- All statements use IF NOT EXISTS and are safe to re-run.
--
-- Alternatively, call initDb() from client.ts at application boot.
-- Better-Auth tables (user, session, account, verification) are also created
-- by `npx @better-auth/cli migrate` — both approaches are equivalent.
-- ============================================================================

-- IMPORTANT: Column names are camelCase — better-auth's Kysely adapter writes
-- camelCase field names directly; snake_case columns cause 42703 errors.
CREATE TABLE IF NOT EXISTS "user" (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  image          TEXT,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- admin plugin: role controls /admin/* access; ban columns allow soft-suspension without deletion
  role           TEXT,
  banned         BOOLEAN DEFAULT FALSE,
  "banReason"    TEXT,
  "banExpires"   TIMESTAMPTZ,
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "session" (
  id         TEXT PRIMARY KEY,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ipAddress" TEXT,
  "userAgent" TEXT,
  -- Null for regular sessions; set to the admin's user.id only during an impersonation session
  "impersonatedBy" TEXT,
  "userId"    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
  id                       TEXT PRIMARY KEY,
  "accountId"               TEXT NOT NULL,
  "providerId"              TEXT NOT NULL,
  "userId"                  TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken"             TEXT,
  "refreshToken"            TEXT,
  "idToken"                 TEXT,
  "accessTokenExpiresAt"  TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  scope                    TEXT,
  password                 TEXT,
  issuer                   TEXT,
  "createdAt"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- better-auth 1.7+ scopes account identity by the OAuth provider issuer.
-- Idempotent column migration for pre-existing databases that predate it.
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS issuer TEXT;

CREATE TABLE IF NOT EXISTS "verification" (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Bot identity tables ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_users (
  platform_id INTEGER NOT NULL,
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  first_name  TEXT,
  username    TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bot_threads (
  platform_id  INTEGER NOT NULL,
  id           TEXT PRIMARY KEY,
  name         TEXT,
  is_group     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Platform chat type (e.g. Telegram 'group' | 'supergroup' | 'channel') so the
  -- database panel can distinguish every entity the bot lives in.
  type         TEXT,
  member_count INTEGER,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent column migration for pre-existing databases.
ALTER TABLE bot_threads ADD COLUMN IF NOT EXISTS type TEXT;

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

-- ── Discord Server & Channel mappings ────────────────────────────────────────
-- Allows resolving threadID to serverID so settings act at the Server level.
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
  server_id TEXT NOT NULL REFERENCES bot_discord_server(id) ON DELETE CASCADE,
  name      TEXT,
  type      TEXT
);

-- Idempotent column migration for pre-existing databases.
ALTER TABLE bot_discord_channel ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE bot_discord_channel ADD COLUMN IF NOT EXISTS type TEXT;

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

-- Discord server bans are keyed by server id (not channel) so a ban covers every
-- channel in the guild. Mirrors bot_threads_session_banned's audit style: is_banned
-- defaults to TRUE, an explicit unban sets it FALSE and keeps the reason row.
CREATE TABLE IF NOT EXISTS bot_discord_server_session_banned (
  user_id       TEXT    NOT NULL,
  session_id    TEXT    NOT NULL,
  bot_server_id TEXT    NOT NULL,
  is_banned     BOOLEAN NOT NULL DEFAULT TRUE,
  reason        TEXT,
  PRIMARY KEY (user_id, session_id, bot_server_id)
);

-- ── Session-level config ─────────────────────────────────────────────────────
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

-- ── Bot Premium — grants ANYONE + THREAD_ADMIN + PREMIUM access (not BOT_ADMIN) ──
CREATE TABLE IF NOT EXISTS bot_premium (
  user_id     TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  platform_id INTEGER NOT NULL,
  session_id  TEXT    NOT NULL,
  premium_id  TEXT    NOT NULL,
  PRIMARY KEY (user_id, platform_id, session_id, premium_id)
);

-- ── Platform credentials ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_credential_discord (
  user_id             TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  platform_id         INTEGER NOT NULL,
  session_id          TEXT    NOT NULL,
  discord_token       TEXT    NOT NULL,
  discord_client_id   TEXT    NOT NULL,
  is_command_register BOOLEAN NOT NULL DEFAULT FALSE,
  command_hash        TEXT,
  PRIMARY KEY (user_id, platform_id, session_id)
);

CREATE TABLE IF NOT EXISTS bot_credential_telegram (
  user_id             TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  platform_id         INTEGER NOT NULL,
  session_id          TEXT    NOT NULL,
  telegram_token      TEXT    NOT NULL,
  is_command_register BOOLEAN NOT NULL DEFAULT FALSE,
  command_hash        TEXT,
  PRIMARY KEY (user_id, platform_id, session_id)
);

CREATE TABLE IF NOT EXISTS bot_credential_fluxer (
  user_id      TEXT    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  platform_id  INTEGER NOT NULL,
  session_id   TEXT    NOT NULL,
  fluxer_token TEXT    NOT NULL,
  PRIMARY KEY (user_id, platform_id, session_id)
);

-- ── Session tracking join tables ─────────────────────────────────────────────
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

-- ── Command / event overrides ────────────────────────────────────────────────
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

-- ── Ban records ──────────────────────────────────────────────────────────────
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

-- ── System Admin — globally privileged platform-native user IDs ──────────────
-- Scoped globally (no user_id/session_id) so one record grants bot-wide authority.
CREATE TABLE IF NOT EXISTS system_admin (
  id         TEXT PRIMARY KEY,
  admin_id   TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-user AI provider config: a key/hint/model column pair per provider
-- (openrouter, groq, nvidia, openai, gemini), the active provider, and the
-- per-user agent behavior blob. Renamed from bot_user_groq_key so no provider
-- is implied to be primary.
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
  orcarouter_encrypted_key TEXT,
  orcarouter_key_hint      TEXT,
  orcarouter_model         TEXT,
  fastrouter_encrypted_key TEXT,
  fastrouter_key_hint      TEXT,
  fastrouter_model         TEXT,
  provider                 TEXT DEFAULT 'openrouter',
  agent_settings           JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent column migration for pre-existing databases that predate the
-- unified multi-provider schema.
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS openrouter_key_hint TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS openrouter_model TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS groq_encrypted_key TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS groq_key_hint TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS groq_model TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS nvidia_key_hint TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS nvidia_model TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS openai_encrypted_key TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS openai_key_hint TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS openai_model TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS gemini_encrypted_key TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS gemini_key_hint TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS gemini_model TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS zen_encrypted_key TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS zen_key_hint TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS zen_model TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS orcarouter_encrypted_key TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS orcarouter_key_hint TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS orcarouter_model TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS fastrouter_encrypted_key TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS fastrouter_key_hint TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS fastrouter_model TEXT;
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'openrouter';
-- Per-user AI agent settings blob (trigger word, behavior toggles/limits).
ALTER TABLE bot_user_ai_config ADD COLUMN IF NOT EXISTS agent_settings JSONB;

-- One-time migration from the legacy bot_user_groq_key table (predates the
-- multi-provider feature). Copies groq/openrouter/nvidia columns verbatim,
-- promotes the openai/gemini key+model slots out of the agent_settings blob
-- into their own columns, and folds the blob's activeProvider into the
-- provider column. Safe to run on every boot: ON CONFLICT DO NOTHING makes it
-- idempotent, and the legacy table is only dropped once every row is copied.
INSERT INTO bot_user_ai_config
  (user_id, openrouter_encrypted_key, openrouter_key_hint, openrouter_model,
   groq_encrypted_key, groq_key_hint, groq_model, nvidia_encrypted_key,
   nvidia_key_hint, nvidia_model, openai_encrypted_key, openai_key_hint,
   openai_model, gemini_encrypted_key, gemini_key_hint, gemini_model,
   provider, agent_settings, created_at, updated_at)
SELECT
  user_id,
  COALESCE(openrouter_encrypted_key, ''),
  COALESCE(openrouter_key_hint, ''),
  COALESCE(openrouter_model, ''),
  COALESCE(encrypted_key, ''),
  COALESCE(key_hint, ''),
  COALESCE(groq_model, ''),
  COALESCE(nvidia_encrypted_key, ''),
  COALESCE(nvidia_key_hint, ''),
  COALESCE(nvidia_model, ''),
  COALESCE(agent_settings->>'openaiEncryptedKey', ''),
  COALESCE(agent_settings->>'openaiKeyHint', ''),
  COALESCE(agent_settings->>'openaiModel', ''),
  COALESCE(agent_settings->>'geminiEncryptedKey', ''),
  COALESCE(agent_settings->>'geminiKeyHint', ''),
  COALESCE(agent_settings->>'geminiModel', ''),
  CASE
    WHEN agent_settings->>'activeProvider' IN ('openai', 'gemini')
      THEN agent_settings->>'activeProvider'
    WHEN provider IN ('openrouter', 'groq', 'nvidia') THEN provider
    ELSE 'openrouter'
  END,
  agent_settings - 'activeProvider' - 'openaiEncryptedKey' - 'openaiKeyHint'
    - 'openaiModel' - 'geminiEncryptedKey' - 'geminiKeyHint' - 'geminiModel',
  created_at,
  updated_at
FROM bot_user_groq_key
ON CONFLICT (user_id) DO NOTHING;

DROP TABLE IF EXISTS bot_user_groq_key;

-- Per-user dashboard timezone preference (IANA identifier, e.g. "Asia/Manila").
-- Applied across the dashboard's time-based displays, logs, and bot-facing
-- timestamps (e.g. ban notices) for the account that owns the bot session.
CREATE TABLE IF NOT EXISTS bot_user_timezone (
  user_id    TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  timezone   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
