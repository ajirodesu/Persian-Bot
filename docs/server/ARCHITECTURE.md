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

# Server Layer — Architecture

## Overview

The server layer (`packages/cat-bot/src/server/`) is the HTTP and WebSocket surface of Cat-Bot. It hosts the bot management REST API, the web dashboard authentication system, the per-session Telegram webhook receiver, and real-time browser communication via Socket.IO (bot monitor, live database panel, in-app chat room). It runs as a unified Express application inside the same Node.js process as the bot engine — `app.ts` in the engine layer calls `startServer()` once after all platform transports are wired.

The server is organized into eight sub-systems: bootstrap, auth, routes, controllers, services, repos, sockets, and data contracts.

---

## Module File Tree

```
src/server/
│
├── server.ts                                ← HTTP server bootstrap and Socket.IO initializer
│                                              Creates the Node.js http.Server from the Express app;
│                                              attaches Socket.IO to the raw HTTP server before listen()
│                                              so WebSocket upgrade events are captured below Express;
│                                              registers all Socket.IO handler groups;
│                                              idempotent — multiple callers from engine adapters are safe
│
├── app.ts                                   ← Express application factory (createApp)
│                                              Applies CORS before better-auth (OPTIONS preflight ordering);
│                                              mounts better-auth and adminAuth via toNodeHandler BEFORE
│                                              express.json() so auth reads the raw body stream;
│                                              mounts the Telegram webhook route before json() for the same
│                                              stream-before-parser reason;
│                                              serves the built React SPA from web/dist when present;
│                                              separated from listen() to allow supertest test mounts
│
├── email-template/                          ← Vanilla HTML email layouts
│   └── index.ts                             ← Layout shell and button components mapping web tokens
│                                              to inline CSS for transactional emails
│
├── lib/
│   ├── better-auth.lib.ts                   ← Dual better-auth instance configuration
│   │                                          auth → user portal sessions (/api/auth, cookie: better-auth.*)
│   │                                          adminAuth → admin portal sessions (/api/admin-auth, cookie: ba-admin.*)
│   │                                          Both instances share the same underlying DB adapter;
│   │                                          database adapter is selected at runtime by DATABASE_TYPE env var
│   │                                          (mongodb / neondb (default) / turso);
│   │                                          both carry a before-hook that checks banned status before
│   │                                          any session row is written; adminAuth additionally gates
│   │                                          sign-in to role === 'admin' users only
│   │
   │
│   └── mailer.lib.ts                        ← Gmail SMTP Mailer Singleton
│                                              Lazily initialized transactional email dispatcher;
│                                              gracefully skips delivery if env vars are missing
│
├── middleware/
│   └── rate-limit.middleware.ts             ← In-Memory Fixed-Window Rate Limiter
│                                              Provides REST_LIMIT, VALIDATE_LIMIT, and ADMIN_LIMIT
│                                              presets applied to endpoints to prevent abuse
│
├── routes/
│   └── v1/
│       ├── index.ts                         ← API v1 router aggregator; mounts all domain routers
│       │                                      under /api/v1; stable mount point — adding new resource
│       │                                      groups never touches app.ts
│       │
│       ├── bot.routes.ts                    ← Bot session CRUD + command/event toggle endpoints
│       │                                      POST   /bots              — create new bot session
│       │                                      GET    /bots              — list sessions for auth user
│       │                                      GET    /bots/:id          — single session detail
│       │                                      PUT    /bots/:id          — update session config
│       │                                      DELETE /bots/:id          — permanently destroy session
│       │                                      POST   /bots/:id/start    — boot transport; set isRunning=true
│       │                                      POST   /bots/:id/stop     — tear down transport; isRunning=false
│       │                                      POST   /bots/:id/restart  — restart transport; isRunning unchanged
│       │                                      GET    /bots/:id/commands — list commands + isEnable per session
│       │                                      PUT    /bots/:id/commands/:name — toggle command on/off
│       │                                      GET    /bots/:id/events   — list event modules + isEnable
│       │                                      PUT    /bots/:id/events/:name — toggle event module on/off
│       │
│       ├── admin.routes.ts                  ← Admin-only endpoints; every handler enforces
│       │                                      adminAuth session + role=admin internally
│       │                                      GET    /admin/bots                        — all sessions across all users
│       │                                      GET    /admin/system-admins               — global system admin list
│       │                                      POST   /admin/system-admins               — register new system admin
│       │                                      DELETE /admin/system-admins/:adminId      — revoke system admin
│       │                                      POST   /admin/users/:userId/ban-sessions  — halt user's transports
│       │                                      POST   /admin/users/:userId/unban-sessions — restart user's transports
│       │
│       ├── validation.routes.ts             ← Pre-save credential validation (auth required)
│       │                                      POST /validate/discord  — test Discord token via /users/@me
│       │                                      POST /validate/telegram — test Telegram token via getMe
│       │                                      POST /validate/fluxer   — test Fluxer token via
│       │                                                               api.fluxer.app/v1/users/@me
│       │                                      plus email/OTP + reset-password endpoints
│       │                                      (email-reset, email-status, reset-password/*)
│       │
│       ├── admin-file-manager.routes.ts     ← Admin file-manager endpoints
│       │
│       └── settings.routes.ts               ← Account-level settings endpoints
│
│       NOTE — no fluxer.routes.ts / webhook.routes.ts in this fork.
│       The only non-/api/v1 receiver is the per-session Telegram webhook
│       POST /api/v1/telegram-webhook/:userId/:sessionId, mounted in app.ts
│       BEFORE express.json() — grammy's webhookCallback reads the raw body
│       stream (see app.ts:78-84 + telegram-webhook.registry.ts)
│
├── controllers/
│   ├── bot.controller.ts                    ← Bot session lifecycle request handlers
│   │                                          Auth enforced via requireSession() from validators;
│   │                                          delegates all business logic to botService;
│   │                                          service layer is auth-agnostic and independently testable
│   │
│   ├── admin.controller.ts                  ← Admin-only request handlers
│   │                                          Auth enforced via adminAuth (not auth) — the admin portal
│   │                                          cookie is never accepted on user-facing routes and vice versa;
│   │                                          delegates to botRepo (list) and botService (ban/unban flows)
│   │
│   ├── bot-session-config.controller.ts     ← Commands and events toggle request handlers
│   │                                          Verifies session ownership via botRepo.getPlatformId() before
│   │                                          any DB write; filters commands and events by isPlatformAllowed()
│   │                                          so disallowed entries never appear in API responses;
│   │                                          triggers slash command re-registration on Discord/Telegram
│   │                                          sessions fire-and-forget after a command toggle write
│   │
   │
│   ├── admin-file-manager.controller.ts / bot-database.controller.ts / timezone.controller.ts
│   │
│   └── validation.controller.ts             ← Credential validation handlers
│                                              Discord: GET discord.com/api/v10/users/@me with Bot token
│                                              Telegram: GET api.telegram.org/bot{token}/getMe
│                                              Fluxer: GET api.fluxer.app/v1/users/@me with Bot token
│                                              retry on network faults (withRetry), immediate failure on 401;
│                                              responds HTTP 200 with { valid, error? } so the React hook
│                                              distinguishes network failure from credential rejection;
│                                              also implements email/OTP reset-password endpoints
│                                              (email-reset, email-status, reset-password/request|verify-code|confirm)
│
├── services/
│   └── bot.service.ts                       ← Bot lifecycle orchestration
│                                              createBot: generates UUID sessionId; fetches Discord clientId
│                                              automatically from the token; writes to DB then spawns
│                                              the platform transport fire-and-forget
│                                              updateBot: detects credential changes; triggers slash sync
│                                              only when credentials are unchanged (credential change
│                                              requires a full restart that re-registers on boot)
│                                              startBot: fast path via SessionManager.start() if the
│                                              session closure is still registered; slow path rebuilds
│                                              config from DB credentials and calls spawnDynamicSession
│                                              stopBot: persists isRunning=false then tears down transport;
│                                              swallows "not found" from manager (session may already be stopped)
│                                              restartBot: forces stop + unregister so startBot always
│                                              spawns a fresh transport with current DB credentials
│                                              deleteBot: drains transport before DB writes so in-flight
│                                              messages do not crash against deleted credential rows
│                                              stopAllUserSessions / startAllUserSessions: ban/unban
│                                              orchestrators; stop-then-persist ordering prevents
│                                              session-loader from booting banned sessions on next restart
│
├── repos/
│   └── bot.repo.ts                          ← LRU-cached database reads for the server layer
│                                              Wraps the raw database botRepo with the shared 2000-entry
│                                              LRU cache singleton from lru-cache.lib;
│                                              cache keys: bot:detail:{userId}:{sessionId},
│                                              bot:list:{userId}, bot:platformId:{userId}:{sessionId};
│                                              write-through invalidation on every mutation so dashboard
│                                              reads never serve stale state;
│                                              also invalidates SESSIONS_ALL_KEY on mutations since
│                                              credentials.repo (the session-loader cache) reads the
│                                              same DB rows;
│                                              clearUserCache(): evicts all LRU entries for a userId
│                                              in one sweep; called by the ban orchestrator
│
├── socket/
│   ├── socket.lib.ts                        ← Socket.IO server singleton
│   │                                          initSocketIO(): creates and stores the Server instance
│   │                                          bound to the Node.js HTTP server; CORS config mirrors
│   │                                          the Express CORS config to satisfy browser preflight;
│   │                                          getSocketIO(): safe accessor returning null before init;
│   │                                          callers guard against null for safety
│   │
│   ├── bot-monitor.socket.ts                ← Real-time bot status and log streaming handlers
│   │                                          Log broadcast: subscribes to logRelay EventEmitter and
│   │                                          forwards every entry to all authenticated sockets as bot:log;
│   │                                          also routes keyed session log entries to the bot-log:{key}
│   │                                          Socket.IO room so subscribers only receive their bot's stream;
│   │                                          Status broadcast: subscribes to sessionManager status events
│   │                                          and pushes bot:status:change to all connected clients;
│   │                                          bot:status:request: per-connection handler for page-load
│   │                                          status queries — returns {active, startedAt} per sessionId;
│   │                                          bot:log:subscribe: joins the bot-log:{key} room and hydrates
│   │                                          the client with the server-side sliding window history
│   │                                          immediately so the console is never blank on page load;
│   │                                          bot:log:clear: purges the server-side history buffer for a
│   │                                          session when the client requests a log clear
│   │
│   ├── bot-database.socket.ts               ← Live Database panel sync; forwards dbChangeEmitter events
│   │                                          (bot:database:subscribe/unsubscribe/change) so the dashboard
│   │                                          stays live without polling
│   ├── chat-room.socket.ts                  ← In-app chat room; creates the per-socket WebChatApi via
│   │                                          WebchatSessionProvider and routes messages through the full
│   │                                          engine (sessions keyed by stable sessionId, not socket.id)
│   └── validation.socket.ts                 ← Cookie-authenticated socket handlers (io.use() rejects
│                                              unauthenticated connections via the better-auth session cookie)
│
├── dtos/
│   ├── bot.dto.ts                           ← Bot session request and response type contracts
│   │                                          PlatformCredentials: discriminated union on platform field;
│   │                                          TypeScript exhaustiveness forces every consumer to handle
│   │                                          all three platforms (discord/telegram/fluxer) at compile time;
│   │                                          CreateBotRequestDto / UpdateBotRequestDto / GetBot*Dto
│   │
│   ├── bot-session-config.dto.ts            ← Commands and events toggle API type contracts
│   │                                          Kept separate from bot.dto because these model operational
│   │                                          runtime toggles rather than identity/credential configuration
│   │
│   └── admin.dto.ts                         ← Admin-only API type contracts
│                                              Exposes cross-user data (listAll bots) and global config
│                                              (system admins) that user-facing endpoints must never return;
│                                              separation enforces the boundary at the type level
│
└── utils/
    └── hash.util.ts                         ← Per-session Telegram webhook secret derivation (SHA-256)
                                               generateVerifyToken(userId): SHA-256 of userId+'verify'
│                                              64 lowercase hex chars — within Telegram's secret-token charset
│                                              verify_token so Meta can prove ownership without storing
│
└── validators/                              ← Cross-cutting request validation
    ├── auth-session.validator.ts            ← Centralized requireSession and requireAdmin guards
    └── request-headers.validator.ts         ← Normalizes Express IncomingHttpHeaders to Web API Headers
```

---

## Architectural Layers

### Bootstrap Layer (`server.ts`, `app.ts`)

`startServer()` is the single call-site for the entire HTTP lifecycle. It constructs the Express app via `createApp()`, then wraps it in a raw `http.Server` before calling `.listen()`. Socket.IO is attached to the raw server — not the Express app — so WebSocket upgrade requests are handled at the Node.js HTTP level before Express routing runs.

`createApp()` enforces a strict middleware registration order that is not stylistic but structurally required:

```
src/server/app.ts registration order:
│
├── cors()                         ← Must precede all handlers so OPTIONS preflight
│                                    receives Access-Control-Allow-* before any auth
│
├── toNodeHandler(auth)            ← better-auth reads the raw IncomingMessage stream;
│   /api/auth/{*any}                 express.json() must not run first or the body is consumed
│
├── toNodeHandler(adminAuth)       ← Same stream constraint; separate basePath so Express
│   /api/admin-auth/{*any}           routes admin traffic to the independent betterAuth instance
│
├── POST /api/v1/telegram-webhook  ← grammy RequestListener reads the raw stream;
│      /:userId/:sessionId           registered before express.json() for the same reason;
│                                    handler resolved lazily from telegram-webhook.registry
│
├── express.json()                 ← All routes below here safely read req.body
│   express.urlencoded()
│
├── /api/v1/validate               ← VALIDATE_LIMIT (20 req / 60 s) protects credential checks
├── /api/v1/admin                  ← ADMIN_LIMIT (60 req / 60 s) reduces admin enumeration blast radius
├── /api/v1                        ← REST_LIMIT (120 req / 60 s) general dashboard rate limit
│
├── /api/v1/fluxer          ← Fluxer/WebChat webhook delivery
│
├── /api/v1                        ← All other REST API routes
│
├── GET /api/v1/health             ← Simple liveness check
│
└── SPA static serve               ← Serves React build from web/dist when present;
    GET /{*splat}                    catch-all for React Router client-side navigation
```

### Auth Layer (`lib/better-auth.lib.ts`)

Two independent `betterAuth()` instances share the same underlying database adapter but write session cookies under separate prefixes, making the user portal and admin portal session surfaces structurally isolated:

```
lib/better-auth.lib.ts:
│
├── auth                           ← User portal
│   basePath: /api/auth (default)
│   cookie: better-auth.session_token
│   plugins: [admin()]             ← Adds /api/auth/admin/* endpoints
│   before-hook: ban check before session creation
│
└── adminAuth                      ← Admin portal
    basePath: /api/admin-auth
    cookie: ba-admin.session_token
    cookiePrefix: 'ba-admin'
    plugins: [admin()]
    before-hook: ban check + role=admin gate;
                 unknown emails fall through to "invalid credentials"
                 rather than "not an admin" to avoid leaking email enumeration
```

The active database backend is selected at runtime by `DATABASE_TYPE` and the same adapter instance is passed to both `betterAuth()` calls. Signing out of one portal never invalidates the other's session row.

### Route Layer (`routes/v1/`)

All REST API routes are versioned under `/api/v1`. The only route mounted outside it is the per-session Telegram webhook receiver (it must read the raw body stream before `express.json()` runs).

```
routes/v1/index.ts mounts:
│
├── /bots                  → bot.routes.ts                  ← Session CRUD + command/event toggles
├── /validate              → validation.routes.ts           ← Pre-save credential checks (+ email/OTP)
├── /admin                 → admin.routes.ts                ← System administration (role=admin required)
├── /admin-file-manager    → admin-file-manager.routes.ts
└── /settings              → settings.routes.ts             ← Account-level settings

app.ts mounts separately (BEFORE express.json()):
└── POST /api/v1/telegram-webhook/:userId/:sessionId ← grammy webhookCallback via telegram-webhook.registry
```

### Controller Layer (`controllers/`)

Controllers own the auth enforcement and request/response boundary. They extract session information from the request headers, verify it against the appropriate better-auth instance (via the `validators/auth-session.validator.ts` layer), and then delegate to the service or repo layer. The service layer is intentionally auth-agnostic — auth is always enforced in the controller layer, never inside a service method.

The Fluxer validation controller (`validation.controller.ts`) performs a live REST check (`GET api.fluxer.app/v1/users/@me` with `Bot` token, `withRetry` on network faults only). No persistent gateway connection is opened during the validation call.

### Service Layer (`services/bot.service.ts`)

`BotService` is the only orchestration layer that touches both the database (via `botRepo`) and the runtime engine (via `spawnDynamicSession`, `sessionManager`, `prefixManager`). Every lifecycle operation follows a DB-first, transport-second ordering — state is persisted before the transport change takes effect so a process restart always reflects the last committed intent.

```
services/bot.service.ts lifecycle order:
│
├── createBot  → UUID generation → DB write → spawnDynamicSession (fire-and-forget)
├── updateBot  → fetchDiscordClientId → DB update → slash sync (if credentials unchanged)
├── startBot   → DB isRunning=true → SessionManager.start() fast path
│               → spawnDynamicSession slow path (rebuild from DB credentials)
├── stopBot    → DB isRunning=false → SessionManager.stop()
├── restartBot → SessionManager.stop() → unregister → startBot (fresh spawn)
└── deleteBot  → SessionManager.stop() → unregister → DB delete
```

### Repository Layer (`repos/bot.repo.ts`)

The server-layer `botRepo` wraps the raw database adapter with the same LRU cache singleton used by the engine's repo layer. Cache key cross-invalidation with `SESSIONS_ALL_KEY` is the coordination point: mutations in `botRepo` (create, update, updateIsRunning, deleteById) also evict the session-loader's credential cache so a process restart after a dashboard mutation reads fresh data.

### Socket Layer (`socket/`)

Socket.IO is initialized once in `server.ts` after the HTTP server is created. Two handler groups are registered immediately after initialization:

```
server.ts socket registration:
│
├── registerValidationHandlers(io) ← Cookie-auth middleware (io.use()) runs first;
│                                    rejects unauthenticated connections before any
│                                    event handler can fire
│
├── registerBotMonitorHandlers(io) ← Subscribes to logRelay and sessionManager at the
│                                     process level; all authenticated connections see
│                                     the same log stream and status changes
│
├── registerBotDatabaseHandlers(io) ← Forwards dbChangeEmitter events to the Database panel
│
└── registerChatRoomHandlers(io)   ← Per-socket WebChatApi chat room (stable sessionId rooms)
```

The authentication middleware in `validation.socket.ts` extracts the better-auth session cookie from the socket handshake headers. This means the Socket.IO auth check reuses the same `auth` instance as the REST endpoints — a valid browser session cookie grants WebSocket access automatically.

### Data Contracts

```
dtos/ and models/ dependency directions:
│
├── dtos/bot.dto.ts                ← Controllers read this; service + repo implement it
├── dtos/admin.dto.ts              ← Admin controller reads this; admin-scoped repo implements it
├── dtos/bot-session-config.dto.ts ← Config controller reads this; session command/event repos implement it
└── (no models/ dir — PageSessionConfig / webhook models were removed with the Meta transports)
```

DTOs are plain TypeScript interfaces with no runtime behavior. The discriminated union `PlatformCredentials` (keyed on `platform`) is the critical compile-time boundary: TypeScript exhaustiveness checking forces every consumer of credential shapes to handle all three platforms (`discord` / `telegram` / `fluxer`) without relying on runtime guards.

---

## Web-to-Engine Synthesis

The Server layer acts as the mechanical bridge translating **Web** intents into **Engine** state changes, and pushing **Engine** observability back to the **Web**:

- **HTTP to Transport translation:** A `POST /api/v1/bots/:id/start` from the Web does not just flip a database row. The Server's `BotService` intercepts the request, generates a `UUID`, fetches the associated token from the raw Database, and executes `spawnDynamicSession()` in the Engine, instantly bridging the REST API to a live platform transport (gateway / long-poll / webhook).
- **Cross-Portal Auth Isolation:** The Server implements two separate `betterAuth` boundaries. This protects the Engine layer: compromised credentials in the user portal cannot mutate global system state or shut down the Engine, because the `AdminAuthContext` is isolated at the `ba-admin.session_token` cookie level.
- **Socket Pipeline:** The `bot-monitor.socket.ts` directly consumes the Engine's `logRelay` and `SessionManager` state events. It pipes them into `bot:log:keyed` and `bot:status:change` WebSocket events. The Web's `useBotLogs.ts` and `useBotStatus.ts` React hooks bind directly to these channels, meaning a log printed deep within an Engine command module renders on the Web UI entirely reactively.
- **REST Credential Validation:** For all three platforms, `validation.controller.ts` checks the pasted token against the live platform API (`/users/@me` / `getMe`) before the dashboard saves anything — invalid credentials never reach the Engine's session manager. Email/OTP account flows (reset-password, email verification) live on the same controller via `mailer.lib.ts` + `otp.lib.ts`.

---

## Key Design Decisions

**Dual better-auth instances over role-based single instance.** A single instance with role checks would share cookies — a user who gains admin role mid-session would have the same cookie accepted on both portals. Separate instances with separate cookie prefixes mean a compromised user-portal session has zero leverage on the admin portal even when the DB row shows `role: 'admin'`.

**Socket.IO auth middleware over per-event guards.** Placing `io.use()` authentication before any event handler registration means unauthenticated connections never trigger any application code. Per-event guards would require every handler to repeat the session check and would not prevent unauthenticated connections from remaining connected.

**DB-first ordering in lifecycle methods.** `startBot` writes `isRunning=true` before spawning the transport; `stopBot` writes `isRunning=false` before calling stop. This means a process kill between the DB write and the transport action always leaves the DB in a state that session-loader can act on at next boot, rather than in a state inconsistent with what was actually running.

**Cache cross-invalidation via shared `SESSIONS_ALL_KEY`.** `botRepo` and `credentials.repo` are in different packages (server and engine respectively) but share the same LRU singleton. Mutating a bot session in the server layer evicts the key that the engine's session-loader uses so that a restart immediately after a dashboard write picks up the new credential state without a stale cache hit.

**Fire-and-forget transport spawn on create.** `createBot` returns the new session DTO to the client immediately after the DB write succeeds. The platform transport starts concurrently. This keeps the API response time bounded by the DB write, not by Discord gateway handshake or Telegram getMe latency.

**Stateless HMAC Email Reset Tokens over In-Memory Maps.** `validation.controller.ts` generates HMAC-signed payload tokens (containing email, expiry, and admin flag) rather than keeping state in a server-side `Map`. This ensures pending tokens survive process restarts and hot-reloads, with a small `Set` to track used signatures preventing replay attacks.

**Centralized Request Validation.** Controllers previously duplicated auth logic; `validators/auth-session.validator.ts` now centralizes `requireSession` and `requireAdmin` checks, ensuring isolated cookie verification (user vs admin) without duplicate code.
