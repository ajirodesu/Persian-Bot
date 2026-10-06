<!-- PERSIAN-BOT native deltas vs upstream Cat-Bot docs. -->

# Persian-Bot Deltas vs Upstream Cat-Bot

This file records every intentional deviation the adaptation applied to the
upstream docs (`https://github.com/johnlester-0369/Cat-Bot`), so a reader can
trust that anything NOT listed here behaves exactly as `DOCS.md` describes.

## 1. Module contract (`meta`, not `config`)

| Upstream | This repo (native) |
| --- | --- |
| `import type { CommandConfig } from '@/engine/types/module-config.types.js'` | `import type { CommandMeta } from '@/engine/types/module-meta.types.js'` |
| `export const config: CommandConfig = { … }` | `export const meta: CommandMeta = { … }` |
| `import type { EventConfig } from '@/engine/types/module-config.types.js'` | `import type { EventMeta } from '@/engine/types/module-meta.types.js'` |
| `export const config: EventConfig = { …, eventType: […] }` | `export const meta: EventMeta = { …, type: […] }` |

Reference implementations: `packages/cat-bot/examples/commands/*.ts`,
`packages/cat-bot/examples/events/*.ts`
(`src/engine/types/module-meta.types.ts`).

## 2. Platforms

| Upstream | This repo (native) |
| --- | --- |
| Discord (`discord.js ^14`) | Discord (`discord.js ^14.27.0`) — unchanged, see `docs/cat-bot/adapters/DISCORD_ARCHITECTURE.md` |
| Telegram via **Telegraf** | Telegram via **grammy `^1.45.1` + `@grammyjs/runner ^2.0.3`** — see `docs/cat-bot/adapters/TELEGRAM_ARCHITECTURE.md`; upstream Telegraf original kept at `TELEGRAM_ARCHITECTURE.upstream-base.md` for attribution |
| Facebook Messenger via `fca-unofficial` / `fca-cat-bot` | **REMOVED** — replaced by Fluxer |
| Facebook Page via Graph API webhook | **REMOVED** — replaced by Fluxer/WebChat |
| — | **Fluxer** (`@fluxerjs/core ^2.2.0`, id `4`, server-hierarchy like Discord) — see `docs/cat-bot/adapters/FLUXER_ARCHITECTURE.md` |
| — | **WebChat** (Socket.IO in-app chat, id `3`, bypasses unified emitter) — see `docs/cat-bot/adapters/WEBCHAT_ARCHITECTURE.md` |

Platform registry: `src/engine/modules/platform/platform.constants.ts`
(`discord=1, telegram=2, webchat=3, fluxer=4`; `SERVER_HIERARCHY_PLATFORMS =
[discord, fluxer]`).

## 3. Database adapters

| Upstream | This repo (native) |
| --- | --- |
| `json` (flat-file, zero-dep) | **REMOVED** |
| `prisma-sqlite` (Prisma + better-sqlite3, default) | **REMOVED** — replaced by `turso` (libSQL) |
| `mongodb` | Kept (`packages/database/adapters/mongodb`, dep `mongodb`) |
| `neondb` (node-postgres) | Kept, **now the default** (`packages/database/adapters/neondb`, dep `pg`) |
| — | **Added `turso`** (`packages/database/adapters/turso`, deps `@libsql/client, @libsql/kysely-libsql`) |

Selection: `packages/database/src/index.ts` → `mongodb.js` if
`DATABASE_TYPE=mongodb`, `turso.js` if `turso`, else `neondb.js`.
Quick-start therefore uses `DATABASE_TYPE=neondb` (or `turso`/`mongodb`), NOT
`DATABASE_TYPE=json`.

## 4. AI agent removed

Upstream `packages/cat-bot/agent/` (Groq-powered ReAct loop) and its doc
references were removed in this fork (`git log`: `refactor: remove AI Agent
configuration`). Do not follow upstream agent setup steps.

## 5. Related code status

- `packages/cat-bot/examples/commands/` (5 files) and
  `packages/cat-bot/examples/events/` (2 files) already use the native `meta`
  contract — they are the canonical copy-paste starters. Upstream originals
  differ only by `config`/`eventType` naming (see `git diff` notes in
  `docs/UPSTREAM_README.md` header if needed).
- `packages/cat-bot/src/app/commands/` and `src/app/events/` in this repo have
  diverged substantially from upstream (Persian-Bot command roster); docs
  describe the engine contract, not any specific command list.
- Upstream `README.md` / `CHANGELOG.md` are preserved verbatim at
  `docs/UPSTREAM_README.md` / `docs/UPSTREAM_CHANGELOG.md` for attribution only.
