# AI Agent — Architecture & Operator Guide

Persian-Bot ships a Reze-style AI engine as a reusable subsystem
(`packages/cat-bot/src/engine/ai/`). It plugs into the existing engine:
commands, permissions, database collections, dashboard API, and themes are all
reused — nothing is replaced. Upstream credit: see `THIRD_PARTY_NOTICES.md`
(Reze-Bot, MIT, GrandpaEJx).

## Contents

- [Talking to the AI](#talking-to-the-ai)
- [Providers & fallback](#providers--fallback)
- [Agents](#agents)
- [Tool loop & tools](#tool-loop--tools)
- [Memory](#memory)
- [Prompt architecture](#prompt-architecture)
- [Moderation & policy](#moderation--policy)
- [Editor agent](#editor-agent)
- [Graph runtime](#graph-runtime)
- [Dashboard page](#dashboard-page)
- [API reference](#api-reference)
- [Environment variables](#environment-variables)
- [Security boundaries](#security-boundaries)
- [Testing](#testing)
- [Limitations](#limitations)

## Talking to the AI

Users chat with `!ai <question>` (alias `!ask`). The command runs
`runChatAgent()` (`engine/ai/service.ts`): profile/memory load → deterministic
prefetch → budgeted prompt → bounded tool loop → memory persist → reply.

The bot also answers on its own: in groups when its nickname is mentioned
(`@nick`, bare name, or platform mention), and in DMs for every message.
Mention replies skip command invocations, AI-initiated events, and the bot's
own messages; they are rate-limited (one per user per thread per minute) and
toggleable per owner (`autoReply.mention` / `autoReply.dm`, dashboard
Auto-reply section, both default on).

The engine never claims actions it did not take, never invents commands or
live server data, and degrades to plain conversational answers when tools or
providers fail.

## Providers & fallback

Conceptually supported: Groq, OpenRouter, DeepInfra, Venice, OpenAI, Together,
Fireworks, Lepton, Ollama, LM Studio, and arbitrary OpenAI-compatible custom
endpoints (`registerProvider()` + per-agent `baseUrl`). None is required; the
engine walks whatever is configured.

- Retries HTTP 429/502/503/504 with exponential backoff and `Retry-After`
  (`provider/base.ts`); treats 200-with-error bodies as errors so
  rate-limited models rotate instead of returning empty completions.
- Timeouts via `AbortController`; malformed/empty completions rotate to the
  next model; 401/403 skips the whole provider; tool-rejecting models retry
  without tools; JSON-rejecting models retry without JSON mode.
- Model rotation inside a provider happens before falling to the next
  provider. With a single candidate, 429s back off in place.
- The bot never crashes because a provider failed; the final error is logged
  (without secrets) and the user gets a degraded plain answer or a short
  honest failure note.
- **Test connection:** `POST /api/v1/ai/test` sends a tiny probe through the
  selected agent and reports provider, model, latency, and attempts — also
  available as the "Test connection" button on the dashboard AI Agent page.
- **Live model catalog:** `GET /api/v1/ai/providers/:name/models` returns the
  provider's real model ids (`GET {base}/models`, with Ollama `/api/tags`
  fallback) using the caller's stored key — the dashboard "Load live models"
  picker is backed by this, so operators pick models that actually exist.

## Agents

`engine/ai/config.ts` resolves, in increasing precedence:

```text
built-in defaults < AI_* env < persisted dashboard config
  < ai.agents.default < ai.agents.<name> < per-call overrides
```

Standard agents: `default`, `moderator`, `moderator2`, `policy`, `editor`.
Specialized agents inherit `default` unless they name their own provider,
model(s), temperature, tokens, JSON mode, timeout, or `fallback` chain.
`describeRouting()` shows the live attempt order per agent.

## Tool loop & tools

Real loop (`engine/ai/loop.ts`), bounded by `maxSteps` (default 6),
`timeoutMs` (default 90s), `maxToolErrors` (3), `maxCallsPerStep` (3),
identical-call detection (stops on the 3rd repeat), and unknown-tool
detection (disables tools after 2 misses, answers in plain text).

The tolerant parser (`tool-parse.ts`) accepts `TOOL: {...}`,
`<tool_call>`, `<function=name>`, `name({...})`, ReAct `Action/Action Input`,
loose JSON with alias keys (`tool`/`args`/`params`/…), and bare names — but
only for actually registered tools, so user JSON is never executed.

Built-in tools (`builtin-tools.ts`, native command execution ported from
upstream Cat-Bot's `engine/agent/tools/`):

| Tool | Risk | Notes |
|---|---|---|
| `list_commands` | 0 read | Searches the live `commandRegistry`; role-filtered; never pasted into prompts |
| `test_command` | 1 action | Silently previews commands against a mock API proxy (nothing reaches the chat); guard-checked (bans, full role matrix, dashboard toggles, platform, maintenance, admin-only, cooldown-checked-not-consumed); returns a key + LLM-readable captured calls incl. attachments/buttons |
| `send_result` | 1 action | Delivers ONE synthesized message merging stored attachments (URL + binary), button grids, and text; single-use keys; drops buttons when files exceed one (platform rule) |
| `get_context` | 0 read | Time, platform/thread, role, stored user memory |
| `remember_fact` | 1 action | User-stated facts only; refuses secrets/credentials/forget-requests |
| `get_server_info` | 0 read | Current server/channel the bot can see; cross-server lookups need BOT_ADMIN |
| `list_servers` | 0 read | Session visibility; full inventory needs BOT_ADMIN |

Command flow: `test_command` (preview, cooldowns never consumed) → agent reads
the captured output → `send_result` (one delivery). When `send_result`
delivers, the `!ai` command stays silent instead of double-posting.

MCP/Skills: the registry is unified by design — `GET /api/v1/ai/tools`
returns `{ builtIn, mcp, skills }` where the latter two are the caller's own
DB-backed integrations (see below). Secrets stay sealed server-side.

## Database persistence

All AI state lives in the database — no JSON files, no memory-only records:

| State | Storage |
|---|---|
| Per-user AI config (providers, keys encrypted, models, agents, memory, execution, moderation) | `bot_user_ai_config` (`provider*` columns + `agent_settings` blob) via `engine/repos/ai-config.repo.ts` (60s snapshot cache, explicit invalidation on save) |
| User MCP servers & Skills | `bot_user_mcp_skills` via `engine/repos/mcp-skills.repo.ts` (secrets field-level encrypted, everything else reviewable) |
| Conversation turns, summaries, profiles, facts | `db.users` / `db.threads` `ai_memory` collections (survives restarts) |
| Moderation policies per thread | `db.threads` `ai_memory.moderation_policy` via `threadPolicyHandles()` |
| Moderation audit trail | In-memory ring + `db.threads` `ai_memory.moderation_audit` (capped 100) via `threadAuditPersister()` |

The hot chat path reads short-lived snapshots/caches so no message waits on
a DB round-trip; dashboard saves write through and invalidate immediately.

## User MCP servers & Skills

Operators add their own integrations from the dashboard AI Agent page
(Tools → MCP servers / Skills) or `POST /api/v1/ai/integrations`:

- **MCP server:** `{ kind: 'mcp', name, config: { url, headers?, timeoutMs? } }` —
  Streamable-HTTP JSON-RPC (`initialize` → `tools/list` → `tools/call`, JSON
  and SSE responses, per-call timeouts). Advertised tools become agent tools
  under `mcp__<server>__<tool>` names (max 12 per turn). Turn-scoped
  resolution keeps one owner's servers out of every other owner's turns.
- **Skill (webhook tool):** `{ kind: 'skill', config: { mode: 'tool', url, headers?, parameters?, timeoutMs? } }` —
  arguments POSTed as JSON; flexible `{content|text|result|message}` parsing,
  plus optional `attachments: [{name, url}]` the agent delivers to the chat.
- **Skill (prompt pack):** `{ kind: 'skill', config: { mode: 'prompt', instructions } }` —
  budgeted extra system-prompt section (no code execution surface at all).

Every save is validated (`validateIntegrationInput`: names, URLs, header
caps, timeout bounds, JSON schemas) and scanned. Each entry has a **Test**
button (`POST /api/v1/ai/integrations/:id/test`) that probes connectivity
and re-scans the live tool surface — newly discovered danger auto-restricts
immediately. Owners can edit and **delete their own entries** at any time
(ownership-checked, 404 otherwise); an entry only ever runs on its owner's
bot sessions (`native.userId` scoping, verified by test).

## Attachments through the AI

- Commands previewed via `test_command` capture everything — text, URL
  attachments, binary file bytes, button grids — and `send_result` replays
  them in a single synthesized reply, exactly as if a human ran the command.
  The agent never re-describes delivered output as its own.
- Tool results may additionally carry `attachments: [{name, url}]`
  (http(s) only, deduplicated, max 3 per turn); the `!ai` command delivers
  them with its reply via `attachment_url`. Model-typed strings, local
  paths, and non-http schemes are rejected at collection time.

## Danger auto-restriction

`engine/ai/mcp/scan.ts` inspects names, descriptions, URLs, headers,
parameters, instructions, and advertised MCP tool names:

- **Critical** (shell/code execution, `rm -rf`, `curl|sh`, `file://`,
  cloud metadata SSRF, destructive tool names, prompt-override directives)
  → `risk: 2`, `minRole: 4` (SYSTEM_ADMIN), `status: 'restricted'`.
- **Suspicious** (internal endpoints, delete/write keywords, secrets to
  third parties) → `risk: 1`, `status: 'pending_review'` (unusable until an
  admin approves).

Users can never relax enforcement: risk/minRole ratchet only upward and
flagged entries stay flagged through edits — only an admin can clear them.
A runtime backstop additionally forces any listed tool that looks dangerous
to system-admin-only even on approved entries.

## Admin oversight

Admins see **all** users' integrations at `/admin/dashboard/mcp-skills`
("MCP & Skills" sidebar) backed by `GET /api/v1/admin/mcp-skills`:
owner email/name, kind, risk/status badges, danger reasons, and per-row
Approve / Restrict / Disable / Enable / **Edit** / **Delete**. Editing any
entry (config, risk, role floor, status) is admin-supreme; deletes are
immediate. Sealed secrets render masked and survive masked re-saves.

## Memory

`engine/ai/memory.ts`: per-user profiles (name, language, message count,
≤12 durable facts), per-thread bounded history (default last 20 turns),
AI summarisation of older turns with digest fallback (a failed summariser
never loses the conversation). Persistence is best-effort through
`db.users`/`db.threads` `ai_memory` collections, so state survives restarts;
memory always works in-memory when the DB is unreachable.

## Prompt architecture

`prompt-builder.ts` assembles `identity(0) → rules(0) → prefetched live
data(0) → chat context(1) → persona(2) → summary+memory(3) → examples(4)`
under a 12,000-character budget; low-priority sections drop whole, never
mid-sentence. Priority-0 sections always survive (overflow is reported, not
hidden). Command discovery is dynamic — the catalog is never in the prompt.

## Moderation & policy

`moderateMessage()` (`service.ts`): deterministic rules first
(deny/allow domain lists, `off`/`strict` modes, exempt senders), then the
moderator agent only when needed, then a confidence gate — low-confidence
destructive verdicts become `flag`, never `delete`. Malformed model output
coerces to safe `allow/unknown/0`. Borderline calls escalate to an
independent second model (`moderator2`, no anchoring) when `secondOpinion`
is on; agreement raises confidence, disagreement stays conservative.
`dryRun` (default on) logs without enforcing. Outcomes are recorded in the
audit ring (`recentModerations()`).

### Guardian command (native Reze-Bot port)

`app/commands/guardian.ts` is the native Persian-Bot port of Reze-Bot's
`app/commands/guardian.ts` + `core/system/guardian.ts`: a passive `onChat`
hook that judges every group message before command dispatch. AI-initiated
synthetic messages and the bot's own messages are never moderated.

- Exemptions: system admins, whitelisted users, premium (when configured),
  thread/bot admins — whose messages also feed the topical admin-context
  buffer (scoped per owner/platform/session/thread, depth 8, 6h TTL).
- Obfuscated links (`spam dot com`, `t . me / x`) are deobfuscated before
  list matching, in both the gate and the rule engine.
- Enforcement is per-thread opt-in (default disabled + dry-run) and honest
  about the unified API: best-effort `unsendMessage` (works where the
  platform grants deletion rights, degrades to warn + audit elsewhere),
  rate-limited warning replies (5/min per thread, 5-min per-user cooldown),
  and a 5/minute runaway cap. Mute/ban verdicts map to delete + warn —
  members are never kicked automatically, and there is no cross-platform
  mute primitive to call.

`compileOrder()` (`policy.ts`) turns an owner's natural-language order into a
validated patch: only recognised fields survive, `dryRun` and `whitelist`
can never change via the agent, `diffPatch()` previews the change before any
human applies it.

## Editor agent

`draftPost()` / `rewritePost()` (`editor.ts`) return `{ text, summary }`
within platform length limits, in the instruction's language. Drafts only —
publishing always goes through the existing human approval workflow.

## Graph runtime

`graph.ts`: `agent | tool | transform | gate | router | parallel` nodes,
pre-execution validation (dangling edges fail fast), `maxSteps` /
`maxVisitsPerNode` / `timeoutMs` bounds, and per-run traces
(`formatTrace()`). Used by moderation consensus; available for future agents.

## Dashboard page

`/dashboard/ai-agent` (sidebar: AI Agent, `Sparkles` icon — `Bot` was already
taken by Bot Manager and identical adjacent icons would be indistinguishable
in the collapsed rail). Native Settings-page vocabulary, all three themes,
skeleton/Alert/empty states, explicit Save/Cancel with dirty tracking, masked
API keys (never rendered raw), mobile drawer + collapsed rail support, hover
prefetch, timezone-style searchable model pickers (live catalog + custom ids
+ per-agent inherit/clear). Sections: Overview (with Test connection), General (with live-model
picker), Agents, Memory, Tools (built-ins + own MCP/Skills with add/edit/test/
delete), Execution, Moderation, Provider fallback.

## API reference

All under `/api/v1/ai/*`, dashboard-session authenticated:

| Method & path | Purpose |
|---|---|
| `GET /ai/status` | Overview card data (enabled/configured/provider/model/candidates/tools) |
| `GET /ai/config` | Full editable config, secrets masked (per-user, DB-backed) |
| `PUT /ai/config` | Validate + persist to DB (empty key keeps stored secret) |
| `POST /ai/test` | Live provider connectivity probe (provider/model/latency/attempts) |
| `GET /ai/routing` | Per-agent attempt order |
| `GET /ai/tools` | `{ builtIn, mcp, skills }` registry incl. own integrations |
| `GET /ai/candidates?agent=` | Model candidates for one agent |
| `GET /ai/providers/:provider/models` | Live model catalog for a provider |
| `GET /ai/integrations` | Own MCP servers & Skills (secrets masked) |
| `POST /ai/integrations` | Add MCP/Skill (validated + auto-scanned, max 20/user) |
| `PUT /ai/integrations/:id` | Edit own entry (re-scanned, never de-restricted) |
| `DELETE /ai/integrations/:id` | Delete own entry |
| `POST /ai/integrations/:id/test` | Probe + rescan (auto-restricts new danger) |
| `GET /admin/mcp-skills` | All users' integrations with owner identity (admin) |
| `PUT /admin/mcp-skills/:id` | Admin edit incl. approve/restrict/disable (admin) |
| `DELETE /admin/mcp-skills/:id` | Admin delete any entry (admin) |
| `POST /ai/draft` | Editor draft (`instruction`, optional `original`) — never publishes |
| `POST /ai/moderate` | Dry-run classification of one message |
| `GET /ai/policy?threadId=` | Current thread policy |
| `GET /ai/policy/default` | Blank policy shape |
| `POST /ai/policy/compile` | NL order → validated patch + human diff (no apply) |
| `POST /ai/policy/validate` | Validate a raw patch without applying |
| `GET /ai/audit?limit=` | Recent moderation audit entries |

## Environment variables

| Variable | Purpose |
|---|---|
| `AI_ENABLED` | Master switch (`true` default) |
| `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL` / `AI_BASE_URL` | Legacy single-provider shortcut |
| `AI_MAX_TOKENS` / `AI_TEMPERATURE` | Global generation tuning |
| `<NAME>_API_KEY` / `<NAME>_BASE_URL` / `<NAME>_MODELS` | Per-provider keys, e.g. `GROQ_API_KEY`, `OPENROUTER_MODELS` (comma-separated) |

Dashboard-saved values persist per-user to the `bot_user_ai_config` table
(keys encrypted at rest) under env-provided values in precedence:
built-in defaults < `AI_*` env < DB settings < `agents.default` <
`agents.<name>` < per-call overrides.

## Security boundaries

- API keys are masked in every API response and never logged; the frontend
  never places them in URLs and only sends a key when the operator typed a
  new one. Provider keys are AES-256-GCM encrypted in the database.
- AI command previews inherit the human gates: role matrix, bans, dashboard
  toggles, platform filter, maintenance mode, session/thread admin-only.
  Cooldowns are checked but never consumed by previews; developer / admin
  commands stay restricted; recursion is blocked by the `aiInitiated`
  marker.
- Moderation defaults to dry-run; low confidence never deletes.
- `remember_fact` refuses secrets, tokens, and forget-requests.
- User MCP/Skills are validated, scanned, and auto-restricted on save;
  dangerous entries run for system admins only after admin approval, and
  admins can review/edit/delete every entry.
- At most 20 integrations per user; third-party tool injection is capped per
  turn and every call passes registry validation, timeouts, and role checks.

## Testing

```bash
npm run test -w packages/cat-bot      # 174 AI unit tests (vitest)
```

Covers: agent loop (direct/chained/failed/repeated/unknown/timeout/max-steps/
budgets/plain fallback), every parser syntax + alias keys, JSON
(clean/fenced/reasoning/malformed/labelled fallback), memory (profiles, facts,
dedup, truncation, failed-summary fallback), prefetch (capability/listing/
follow-up/unrelated silence), providers (429/502/503/504/timeout/rotation/
fallback/embedded errors), moderation (allow/delete/borderline/consensus/
disagreement/malformed), policy (valid/partial/invalid/malicious/dry-run
protection), graph (valid/dangling/gate/router/tool/parallel/timeout/cycles),
per-user config snapshots, danger scanner, integration validation, MCP client
(JSON/SSE/errors/timeout/cache), integration gating/backstop/probing,
turn-scoped tool resolution, attachments (collection/validation/skill
forwarding), live model catalog, guardian gate/enforcement/rate-cap/context,
per-owner integration isolation.

Not covered by automated tests (documented limitation): end-to-end live chat
turns and live-DB repo round-trips, which require real provider keys and a
live database; these paths fail safe and were additionally verified manually
against the production Turso database (config save/load with encrypted keys,
MCP CRUD, admin list-all with owner identity, full cleanup).

## Limitations

- Per-agent fallback chains are configured via API/persisted config; the
  dashboard edits primary provider/model per agent and displays the resolved
  fallback order read-only.
- MCP servers speak Streamable HTTP JSON-RPC only (no stdio execution —
  spawning local processes from chat input is out of scope by design).
- The `bot_user_agent_config` legacy table is untouched.
