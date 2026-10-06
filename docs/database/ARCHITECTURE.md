<!--
  PERSIAN-BOT ADAPTATION NOTICE
  Source: https://github.com/ajirodesu/Persian-Bot (this repository)
  Upstream credit: https://github.com/johnlester-0369/Cat-Bot
  This file was extracted from upstream docs and adapted natively for this
  repository (Persian-Bot fork). Native deltas vs upstream:
  - Command/event modules use `export const meta: CommandMeta/EventMeta`
    from `@/engine/types/module-meta.types.js` (NOT `config` / `module-config`).
    Event subscription field is `type:` (NOT `eventType:`).
  - Platforms are discord + telegram (grammy, NOT Telegraf) + fluxer
    (@fluxerjs/core, replaces facebook-messenger/facebook-page) + webchat
    (Socket.IO in-app chat). See docs/cat-bot/adapters/.
  - Database adapters here are mongodb + neondb (default) + turso
    (upstream json + prisma-sqlite were removed).
  - The upstream `agent/` (Groq ReAct) directory was removed in this fork.
  Transport-agnostic APIs (chat/state/button/db/ctx/middleware) are unchanged.
-->

# Database Package — Architecture

## Overview

The `packages/database/` package is the **raw data layer** for Cat-Bot. It contains four fully independent adapter implementations that expose a uniform function-level API. No caching lives here — all LRU caching is owned exclusively by `packages/cat-bot/src/engine/repos/`. All application code imports from the single package name `'database'`; the active adapter is selected at runtime via the `DATABASE_TYPE` environment variable.

The three adapters are structurally parallel: each implements the same set of repository modules covering the same domain objects (users, threads, sessions, credentials, bans, commands, events, system admins). Swapping adapters requires only changing `DATABASE_TYPE` — no application code changes.

---

## Monorepo Position

```
Cat-Bot/
└── packages/
    ├── cat-bot/                         ← Imports from 'database'; owns LRU cache layer in src/engine/repos/
    └── database/                        ← This package — raw repo implementations, no cache
```

`packages/cat-bot` declares `"database": "file:../database"` in its `package.json`. The `database` package's `exports` field maps `"."` to `src/index.ts` (source) and `dist/database/src/index.js` (compiled), so both `tsx --conditions source` (dev) and `node dist/` (prod) resolve correctly.

---

## Package File Tree

```
packages/database/
│
├── src/                                 ← Unified public surface; always import from here
│   ├── index.ts                         ← Entry point: reads DATABASE_TYPE, dynamic-imports the
│   │                                      correct barrel, re-exports every function individually;
│   │                                      never import sub-paths directly from application code
│   │
│   ├── mongodb.ts                       ← Static barrel re-exporting from adapters/mongodb/src/
│   ├── neondb.ts                        ← Static barrel re-exporting from adapters/neondb/src/
│   └── turso.ts                         ← Static barrel re-exporting from adapters/turso/src/
│
├── adapters/
│   │
│   ├── mongodb/                         ← MongoDB driver adapter
│   │   ├── src/
│   │   │   ├── client.ts               ← MongoClient singleton with globalThis hot-reload guard;
│   │   │   │                              normalizes MONGODB_URI <PASSWORD> placeholder;
│   │   │   │                              getMongoDb(): returns Db for MONGO_DATABASE_NAME
│   │   │   ├── cat-bot/
│   │   │   │   ├── banned.repo.ts       ← upsert-based ban/unban; updateOne no-ops on absent docs
│   │   │   │   ├── bot-session-commands.repo.ts  ← bulkWrite with $setOnInsert preserves isEnable=false rows
│   │   │   │   ├── bot-session-events.repo.ts    ← same $setOnInsert bulkWrite pattern as commands
│   │   │   │   ├── credentials.repo.ts  ← Discord/Telegram/Fluxer credential state; bot admin via botAdmins collection;
│   │   │   │   │                          bot premium via botPremiums collection
│   │   │   │   ├── threads.repo.ts      ← upsertOne with $set/$setOnInsert; participantIDs and adminIDs as flat arrays;
│   │   │   │   │                          getThreadSessionData stores JSON blob as string in data field
│   │   │   │   ├── users.repo.ts        ← upsertOne; getUserSessionData/setUserSessionData JSON blob via data field
│   │   │   │   └── server/
│   │   │       ├── bot.repo.ts          ← BotRepo class; non-transactional (Atlas free tier constraint);
│   │   │       │                          listAll() uses userId→user lookup map for O(users+sessions) complexity
│   │   │       └── system-admin.repo.ts ← systemAdmin collection; randomUUID for id field
│   │   ├── package.json                 ← name: database-mongodb; dependencies: mongodb ^7
│   │   └── (no tsconfig — compiled via database/tsconfig.json rootDirs)
│   │
│   ├── neondb/                          ← Neon PostgreSQL adapter (node-postgres)
│   │   ├── src/
│   │   │   ├── client.ts               ← pg.Pool singleton; normalizeConnectionString() strips
│   │   │   │                              sslmode/channel_binding params before Pool construction;
│   │   │   │                              initDb(): idempotent CREATE TABLE IF NOT EXISTS DDL for all tables;
│   │   │   │                              dbReady: Promise<void> — await before first query at boot
│   │   │   ├── index.ts                ← adapter barrel; re-exports pool, initDb, dbReady alongside all repos
│   │   │   ├── schema.sql              ← standalone DDL file; equivalent to initDb(); for psql/SQL editor use
│   │   │   ├── cat-bot/
│   │   │   │   ├── banned.repo.ts       ← INSERT ON CONFLICT DO UPDATE for ban; UPDATE for unban (preserves reason)
│   │   │   │   ├── bot-session-commands.repo.ts  ← multi-row INSERT with ON CONFLICT DO NOTHING; shared $1/$2/$3 params
│   │   │   │   ├── bot-session-events.repo.ts    ← same multi-row INSERT pattern as commands
│   │   │   │   ├── credentials.repo.ts  ← parameterized queries; ON CONFLICT DO NOTHING for admin/premium inserts
│   │   │   │   ├── threads.repo.ts      ← explicit BEGIN/COMMIT for upsertThread (ghost user rows + M:M junction
│   │   │   │   │                          DELETE+INSERT must be atomic to prevent isThreadAdmin race conditions);
│   │   │   │   │                          getThreadSessionData/setThreadSessionData via TEXT data column
│   │   │   │   ├── users.repo.ts        ← ON CONFLICT DO UPDATE SET last_updated_at = NOW() for upsertUserSession;
│   │   │   │   │                          explicit timestamp stamp required (no @updatedAt equivalent in raw SQL)
│   │   │   │   └── server/
│   │   │       ├── bot.repo.ts          ← BotRepo class; transactional create/update/deleteById via BEGIN/COMMIT;
│   │   │       │                          listAll() uses LEFT JOIN "user" for single-query owner resolution
│   │   │       └── system-admin.repo.ts ← ON CONFLICT DO NOTHING + follow-up SELECT for idempotent addSystemAdmin
│   │   ├── package.json                 ← name: database-neondb; dependencies: pg ^8, dotenv
│   │   └── tsconfig.json
│   │
│   └── turso/                             ← libSQL (Turso) edge adapter (@libsql/client, kysely-libsql)
    └── src/
        ├── client.ts                ← libSQL client singleton (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN);
        │                              TURSO_TRANSPORT ws/http auto-probe with TURSO_FORCE_HTTP=1 override
        ├── cat-bot/                 ← banned, bot-session-commands, bot-session-events, credentials,
        │                              threads, users repos (same named-export surface as other adapters)
        └── server/                  ← bot, github-config, maintenance-mode, system-admin, timezone repos
    ├── package.json                 ← name: database-turso; dependencies: @libsql/client, @libsql/kysely-libsql
    └── tsconfig.json

├── scripts/                             ← Cross-adapter data migration utilities
│   ├── load-env.ts                      ← Shared dotenv loader for migration scripts
│   ├── load-env.ts                      ← Shared dotenv loader for migration scripts
│   ├── table-defs.ts                    ← Shared table definitions for cross-adapter copies
│   ├── migrate-mongodb-to-neondb.ts
│   ├── migrate-mongodb-to-turso.ts
│   ├── migrate-neondb-to-mongodb.ts
│   ├── migrate-neondb-to-turso.ts
│   ├── migrate-turso-to-mongodb.ts
│   └── migrate-turso-to-neondb.ts
│
├── (no runtime data directory — mongodb/neondb/turso are all external services)
│
├── package.json                         ← name: database; type: module; main + exports point to dist/database/src/index.js
└── tsconfig.json                        ← rootDir: ".."; rootDirs includes all three adapter src trees;
                                           @/ aliases to ./src/ and ../cat-bot/src/; @cat-bot/* to ../cat-bot/src/*
```

---

## Adapter Contract

Every adapter implements the same set of named exports. The `src/index.ts` entry point re-exports each one individually via `export const name = m.name`, where `m` is the dynamically-imported adapter barrel. This design means:

- Adapters load lazily — the dynamic import in `src/index.ts` isolates each adapter's driver graph
- The TypeScript types used throughout the application are always the turso types (imported at compile time via the static barrel); at runtime only the active adapter's code actually executes
- Adding a new function to all adapters is a four-file change (one repo file per adapter) plus a one-line addition in `src/index.ts`

The full exported API surface covers these domain groups:

```
Bot Session Commands  — upsertSessionCommands, findSessionCommands, setCommandEnabled, isCommandEnabled
Bot Session Events    — upsertSessionEvents, findSessionEvents, setEventEnabled, isEventEnabled
Credentials           — findDiscord/TelegramCredentialState, updateDiscord/TelegramCredentialCommandHash,
                        findAllDiscord/Telegram/FluxerCredentials, findAllBotSessions,
                        isBotAdmin, addBotAdmin, removeBotAdmin, listBotAdmins, updateBotSessionPrefix,
                        getBotNickname, isBotPremium, addBotPremium, removeBotPremium, listBotPremiums,
                        getBotSessionData, setBotSessionData
Threads               — upsertThread, threadExists, threadSessionExists, upsertThreadSession,
                        getThreadSessionUpdatedAt, isThreadAdmin, getThreadName,
                        getThreadSessionData, setThreadSessionData, getAllGroupThreadIds,
                        upsertDiscordServer, linkDiscordChannel, getDiscordServerIdByChannel,
                        upsertDiscordServerSession, getDiscordServerSessionUpdatedAt,
                        getDiscordServerSessionData, setDiscordServerSessionData,
                        isDiscordServerAdmin, getDiscordServerName, getAllDiscordServerIds,
                        discordServerExists, discordServerSessionExists
Users                 — upsertUser, userExists, userSessionExists, upsertUserSession,
                        getUserSessionUpdatedAt, getUserName, getUserSessionData,
                        setUserSessionData, getAllUserSessionData
Bans                  — banUser, unbanUser, isUserBanned, banThread, unbanThread, isThreadBanned
Server Repo           — botRepo (BotRepo class: create, getById, update, list, updateIsRunning,
                        getPlatformId, listAll, deleteById)
System Admin          — listSystemAdmins, addSystemAdmin, removeSystemAdmin, isSystemAdmin, listAllUsers
Database Instances    — tursoClient (turso only), mongoClient/getMongoDb (mongodb only),
                        pool/initDb/dbReady (neondb only)
```

---

## Adapter Implementations

### MongoDB Adapter (`adapters/mongodb/`)

Uses the official `mongodb` Node.js driver with a `MongoClient` singleton. The singleton is pinned to `globalThis` in development to prevent connection pool exhaustion across tsx hot-reload cycles.

The `botSessions` and credential collections use camelCase field names shared across adapters. The `user` collection uses the name `user` (singular) to match better-auth's convention; a fallback to `users` (plural) is included in `listAll()` to handle alternative better-auth MongoDB configurations.

Atlas M0/M2/M5 free-tier clusters do not support multi-document transactions. All BotRepo operations are intentionally non-transactional to ensure compatibility with the free tier.

### NeonDB Adapter (`adapters/neondb/`)

Uses `pg` (node-postgres) with connection pooling via `pg.Pool`. Neon's official guidance for long-lived Node.js server processes recommends `pg` over the `@neondatabase/serverless` driver — the serverless driver is designed for stateless edge runtimes where TCP connections cannot persist.

The `normalizeConnectionString()` function strips `sslmode`, `channel_binding`, and `uselibpqcompat` query parameters from the connection URL before passing it to Pool, because `pg-connection-string` v2 cannot parse these Neon-specific params without corrupting the database name field.

Schema initialization is handled by `initDb()`, which runs all `CREATE TABLE IF NOT EXISTS` DDL on boot. The resulting `dbReady: Promise<void>` is exported and awaited in `packages/cat-bot/src/engine/app.ts` before any session or credential queries land. For non-NeonDB adapters, `dbReady` is `undefined` and the await is a zero-cost no-op.

The NeonDB schema uses snake_case column names for all bot tables and camelCase column names for better-auth tables (`"emailVerified"`, `"createdAt"`, `"updatedAt"`, etc.) — better-auth's Kysely PostgresDialect writes camelCase field names directly to PostgreSQL.

### Turso/libSQL Adapter (`adapters/turso/`)

Selected when `DATABASE_TYPE=turso`. Powered by `@libsql/client` (+ `@libsql/kysely-libsql` for the better-auth dialect) against `TURSO_DATABASE_URL` (+ `TURSO_AUTH_TOKEN`); transport auto-probes WebSocket with `TURSO_FORCE_HTTP=1` override (`adapters/turso/src/client.ts`).

Unlike neondb's `pool` (a raw `pg.Pool` passed straight to `betterAuth({ database: pool })`), libSQL has no first-class better-auth adapter — `better-auth.lib.ts` wraps the exported `tursoClient` in a `LibsqlDialect` and passes `{ dialect, type: 'sqlite' }` to `betterAuth({ database: ... })` (see the `isTurso` branch).

---

## Dynamic Adapter Selection

`src/index.ts` reads `DATABASE_TYPE` at module evaluation time and dynamic-imports the appropriate barrel:

```
DATABASE_TYPE=mongodb      → src/mongodb.ts       → adapters/mongodb/src/
DATABASE_TYPE=neondb       → src/neondb.ts        → adapters/neondb/src/
(unset or turso)   → src/turso.ts → adapters/turso/src/
```

Using `await import()` instead of static imports means each adapter's driver graph is only evaluated when selected — a missing driver for an unselected adapter can never crash the process at module evaluation.

The `tsconfig.json` at the database package root uses `rootDirs` to merge all three adapter source trees into a single virtual root. This allows `src/index.ts` to use relative imports to adapter files at compile time while keeping each adapter's own `tsconfig.json` independent.

---

## Migration Scripts (`scripts/`)

The six migration scripts in `scripts/` provide bidirectional data portability between all three adapters (6 = 3 sources × 2 destinations). Each script reads the full dataset from the source adapter and bulk-writes it to the destination adapter. All scripts are invoked via `tsx` and are registered as `npm run migrate:*` commands in the database `package.json`.

Migration scripts are intended for one-time data transfer operations when switching the active adapter for an existing deployment — they are not part of the normal boot sequence.

---

## Better-Auth Integration

Better-auth requires access to the database to manage `user`, `session`, `account`, and `verification` tables. Integration is handled in `packages/cat-bot/src/server/lib/better-auth.lib.ts`, not inside the database package itself. The integration strategy differs per adapter:

```
turso  → betterAuth({ database: { dialect: new LibsqlDialect({ client: tursoClient }), type: 'sqlite' } })
                 No official better-auth libSQL adapter exists — a Kysely dialect is passed directly
mongodb        → betterAuth({ database: mongodbAdapter(mongoClient, { dbName: MONGO_DATABASE_NAME }) })
                 The exported mongoClient is passed to better-auth's MongoDB adapter
neondb         → betterAuth({ database: pool })
                 The exported pg.Pool is passed directly; better-auth uses Kysely's PostgresDialect internally
```

The four better-auth tables (`user`, `session`, `account`, `verification`) are defined alongside the bot tables in every adapter's schema so auth and bot data coexist in the same database file, connection, or cluster.

---

## Cross-Layer Data Synthesis

The `database` package is strictly passive, but it serves as the foundation tying the Web, Server, and Engine together structurally:

- **Shared Connections:** The Engine's bot runtime (via `cat-bot/repos`) and the Server's authentication system (via `better-auth`) both consume these identical raw adapter singletons. A Web dashboard user viewing their profile and a Discord user triggering a command theoretically query through the same physical connection pool (e.g., the NeonDB `pg.Pool`).
- **Cache Authority Boundary:** The database package enforces the boundary of *raw truth*. The Engine's LRU cache (`cat-bot/src/engine/repos`) sits *above* this package. This guarantees that cross-adapter migration scripts (`scripts/migrate-*`) can safely read and write massive datasets natively without accidentally poisoning or triggering the Engine's operational memory cache.
- **Auth & Bot Coexistence:** Because the schemas (libSQL, Postgres, Mongo) embed both `better-auth` tables (`user`, `session`) and Bot tables (`BotSession`, `BotThread`) side-by-side, the Server can perform high-efficiency SQL joins (like `bot.repo.ts` listing bots with their `user` owners) without making cross-database HTTP requests.

---

## Key Design Decisions

**No caching in the database package.** Every function returns raw database results with no in-memory layer. The LRU cache that wraps these functions lives entirely in `packages/cat-bot/src/engine/repos/`. This separation means the cache strategy can change without touching adapter code, and migration scripts can read raw data without inadvertently operating on stale cached values.

**Static barrels for compile-time types, dynamic import for runtime isolation.** Each `src/*.ts` barrel (`mongodb.ts`, `neondb.ts`, `turso.ts`) is a static module that TypeScript resolves at compile time. This gives the rest of the codebase full type safety. The `src/index.ts` entry point wraps the import in `await import()` so only the active adapter's module graph is evaluated at runtime.

**Adapter-parallel structure.** Each adapter has an identical directory layout (`cat-bot/` subdirectory for bot repos, `server/` subdirectory for server-side repos). Adding a new repository function requires one file per adapter plus one re-export line in `src/index.ts` — no other files change.

**No JSON adapter in this fork.** Upstream's `database.json` flat-file store (with `DEFAULT_DB` backfill in `store.ts`) was removed; the portable path between backends is the six `scripts/migrate-*` scripts.

**Shared table definitions as the canonical contract.** `scripts/table-defs.ts` defines the tables shared by all adapters; all three adapters conform to the same named-export function surface, so swapping `DATABASE_TYPE` never changes application code.

**Explicit session-timestamp management across adapters.** Session upserts used for deduplication must always advance the timestamp, or every subsequent message appears stale to the middleware's staleness check. All adapters explicitly advance it on every upsert (e.g. neondb `SET last_updated_at = NOW()`).
