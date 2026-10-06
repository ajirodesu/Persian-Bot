# Third-Party Notices

This repository (Persian-Bot) incorporates or is inspired by the following
third-party software. This file records the required attributions.

---

## Reze-Bot AI Engine

Portions of Persian-Bot's AI/agent architecture are derived from or inspired by:

- Reze-Bot — https://github.com/GrandpaEJx/Reze-Bot
- Current author/maintainer: GrandpaEJx (https://github.com/GrandpaEJx)

Reze-Bot is licensed under the MIT License.
See the upstream repository and its LICENSE file for the complete license text
and attribution requirements.

The Reze-Bot repository also identifies AjiroDesu as the legacy/original author
of Reze Bot and GrandpaEJ as the current author/maintainer. Their upstream
attribution remains acknowledged here where applicable.

### Upstream license text (MIT)

```text
MIT License

Copyright (c) 2025 AjiroDesu (Legacy Author)
Copyright (c) 2026 GrandpaEJ (Current Author)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### What was adapted

The Persian-Bot implementation (`packages/cat-bot/src/engine/ai/`) re-expresses
Reze-Bot's AI/agent architecture — provider abstraction with fallback and
rotation, bounded tool-calling agent loop, tolerant tool-call parser, tool
registry with validation, deterministic prefetch, budgeted prompt assembly,
conversation memory with summarisation, JSON agents with reasoning-tag
sanitisation, editor/moderation/policy agents, confidence gating, second-opinion
consensus, and the multi-agent graph runtime — in Persian-Bot's own engine
idioms (Fluxer/Discord/Telegram/WebChat platforms, `CommandMeta` module
contract, `Role` permission levels, `db.users`/`db.threads`/`db.bot`
collections, Winston logging, Express dashboard API, and the Aqua/Burnt/Indigo
dashboard design system).

No Telegram-specific bot runtime was copied: platform behaviour is implemented
against Persian-Bot's unified adapter layer. Persian-Bot's AI subsystem was
built by the Persian-Bot contributors; upstream authorship is credited above
and is not claimed by this project.

---

## Cat-Bot Agent Tools (upstream command preview & delivery)

Persian-Bot's silent command-preview pipeline (`test_command` execution with
mock-API output capture, `send_result` unified delivery, the command result
store, and the agent command guard) is derived from or inspired by:

- Cat-Bot — https://github.com/johnlester-0369/Cat-Bot
  (packages/cat-bot/src/engine/agent/: `tools/test_command.ts`,
  `tools/send_result.ts`, `lib/command-result-store.lib.ts`,
  `agent-command-guard.lib.ts`)
- Author: John Lester

Cat-Bot is published under the ISC License (as recorded in this
repository's `docs/CREDITS.md`). The implementation was re-expressed in
Persian-Bot engine idioms (CommandMeta/onCommand modules, the Persian
dispatchCommand signature, AppCtx-scoped contexts, native button-ID grids,
five Role levels, session/thread admin-only modes, dashboard command
toggles, and platform filtering).
