<!-- Docs index for this repo (native). Upstream has no equivalent file. -->

# Docs Index

Developer documentation for this repo
([Persian-Bot](https://github.com/ajirodesu/Persian-Bot)), adapted from
upstream Cat-Bot — see [`./CREDITS.md`](./CREDITS.md). Start at the top
and stop when you have what you need.

## Start here

- [`../DOCS.md`](../DOCS.md) — canonical command & event developer reference
  (`AppCtx`, `chat` / `state` / `button` / `db`, middleware, constants, examples,
  migration notes). Adapted: `meta` / `CommandMeta` / `EventMeta` / `type`,
  grammy + Fluxer/WebChat transports, turso/neondb database set.
- [`./PERSIAN-BOT_DELTAS.md`](./PERSIAN-BOT_DELTAS.md) — every intentional
  deviation vs upstream in one table (module contract, platforms, database,
  removed AI agent). Read this if something in an upstream-flavored section
  looks off.
- [`./llms.txt`](./llms.txt) — same reference as `DOCS.md`, formatted as the
  authoritative LLM/agent context (copy-paste into an agent prompt).

## Architecture

- [`./ARCHITECTURE.md`](./ARCHITECTURE.md) — monorepo overview
  (`cat-bot` engine+server, `database` raw adapters, `web` dashboard).
- [`./cat-bot/ARCHITECTURE.md`](./cat-bot/ARCHITECTURE.md) — engine + server
  subsystem detail (transport → middleware → dispatch pipeline).
- [`./database/ARCHITECTURE.md`](./database/ARCHITECTURE.md) — persistence
  layer. Note: native adapter set is `neondb` (default) + `mongodb` + `turso`;
  upstream `json` / `prisma-sqlite` are removed.
- [`./server/ARCHITECTURE.md`](./server/ARCHITECTURE.md) — Express REST +
  Socket.IO management server.
- [`./web/ARCHITECTURE.md`](./web/ARCHITECTURE.md) — Vite + React dashboard.

## Platform adapters (native)

- [`./cat-bot/adapters/DISCORD_ARCHITECTURE.md`](./cat-bot/adapters/DISCORD_ARCHITECTURE.md) —
  discord.js transport (unchanged vs upstream).
- [`./cat-bot/adapters/TELEGRAM_ARCHITECTURE.md`](./cat-bot/adapters/TELEGRAM_ARCHITECTURE.md) —
  **native grammy** transport (this repo). Upstream Telegraf original kept at
  [`TELEGRAM_ARCHITECTURE.upstream-base.md`](./cat-bot/adapters/TELEGRAM_ARCHITECTURE.upstream-base.md).
- [`./cat-bot/adapters/FLUXER_ARCHITECTURE.md`](./cat-bot/adapters/FLUXER_ARCHITECTURE.md) —
  **native** `@fluxerjs/core` transport (replaces upstream facebook-messenger +
  facebook-page; no upstream equivalent).
- [`./cat-bot/adapters/WEBCHAT_ARCHITECTURE.md`](./cat-bot/adapters/WEBCHAT_ARCHITECTURE.md) —
  **native** Socket.IO in-app chat (no upstream equivalent).
- [`./cat-bot/adapters/MODELS_ARCHITECTURE.md`](./cat-bot/adapters/MODELS_ARCHITECTURE.md) —
  unified data contract (`UnifiedApi`, `UnifiedEvent`, context factories, enums).

## Reference copies (verbatim, attribution only)

- [`./UPSTREAM_README.md`](./UPSTREAM_README.md) — upstream `README.md` verbatim.
- [`./UPSTREAM_CHANGELOG.md`](./UPSTREAM_CHANGELOG.md) — upstream `CHANGELOG.md` verbatim.
- [`./cat-bot/adapters/TELEGRAM_ARCHITECTURE.upstream-base.md`](./cat-bot/adapters/TELEGRAM_ARCHITECTURE.upstream-base.md) —
  upstream Telegraf doc verbatim (adapted header only).

## Related code (native, already in repo)

- `packages/cat-bot/examples/commands/` — `example_command.ts`,
  `example_buttons.ts`, `example_reply.ts`, `example_react.ts`, `example_on_chat.ts`
- `packages/cat-bot/examples/events/` — `join.ts`, `leave.ts`
- All use the native `export const meta: CommandMeta / EventMeta` contract.

## Screenshots

- [`./SCREENSHOTS.md`](./SCREENSHOTS.md) — real captures of every web
  page/panel/tab (`./screenshots/`): public pages, user dashboard
  (manager, settings, create-new-bot wizard per platform, chat room),
  and the full admin portal (overview, users + edit dialog, bot sessions
  + delete dialog, git, files, file editor, settings).
