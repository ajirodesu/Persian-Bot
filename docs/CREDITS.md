<!-- Upstream credit for the Persian-Bot documentation set. -->

# Credits

This repository — **[Persian-Bot](https://github.com/ajirodesu/Persian-Bot)**
— is a fork of **[Cat-Bot](https://github.com/johnlester-0369/Cat-Bot)**
by John Lester (ISC License).

The documentation set in `DOCS.md` and `docs/` was extracted from the upstream
Cat-Bot repository and adapted natively for this fork's engine (grammy-based
Telegram, Fluxer and WebChat platforms, `meta`/`CommandMeta` module contract,
neondb/mongodb/turso database set). Verbatim upstream reference copies are kept
for attribution:

- `docs/UPSTREAM_README.md` — upstream `README.md`, unmodified
- `docs/UPSTREAM_CHANGELOG.md` — upstream `CHANGELOG.md`, unmodified
- `docs/cat-bot/adapters/TELEGRAM_ARCHITECTURE.upstream-base.md` — upstream
  Telegraf-based Telegram doc, unmodified

Upstream canonical LLM reference (for cross-checking adaptations):
`https://raw.githubusercontent.com/johnlester-0369/Cat-Bot/refs/heads/main/docs/llms.txt`

## Reze-Bot AI Engine

Portions of Persian-Bot's AI/agent architecture (`packages/cat-bot/src/engine/ai/`,
the `ai` chat command, the `/api/v1/ai/*` dashboard API, and the dashboard
AI Agent page) are derived from or inspired by:

- Reze-Bot — https://github.com/GrandpaEJx/Reze-Bot
- Current author/maintainer: GrandpaEJx (https://github.com/GrandpaEJx)

Reze-Bot is licensed under the MIT License. The full license text and the
complete adaptation notes live in `THIRD_PARTY_NOTICES.md` at the repository
root. The Reze-Bot repository also identifies AjiroDesu as the legacy/original
author of Reze Bot and GrandpaEJ as the current author/maintainer; that
upstream attribution remains acknowledged here where applicable.

## Cat-Bot Agent Tools (upstream command preview & delivery)

Persian-Bot's silent command-preview pipeline (`test_command`, `send_result`,
the preview result store, and the agent command guard in
`packages/cat-bot/src/engine/ai/`) is derived from or inspired by Cat-Bot's
`packages/cat-bot/src/engine/agent/` subsystem by John Lester (ISC License):

- Cat-Bot — https://github.com/johnlester-0369/Cat-Bot

See `THIRD_PARTY_NOTICES.md` for the full notice.
