# Persian-Bot AI Agent — Cactus Needle 3 + Cat-Bot architecture

## 1. Rule

```text
Cactus Needle 3 = AI brain (standalone Render API, decides the tool call)
Persian-Bot     = execution body (validates + executes, owns everything else)
Cat-Bot         = AI-agent architectural source (agent structure, tool
                  modules, help/test/send workflow, guard, result capture,
                  system prompt, bounded loop)
```

## 2. Request flow

```text
Fluxer / Telegram / Discord message
  → handleMessage → /ai command OR passive bot-name mention (ai.ts)
  → runAgent (engine/agent/agent.ts)
  → Needle 3 client (HTTPS + Bearer NEEDLE_API_KEY → POST /v1/complete)
  → Needle 3 tool call (help | test_command | send_result)
  → executed LOCALLY with the authenticated AppCtx
  → help: catalogue detail · test_command: guard + dispatcher + capture
  → tool-result JSON fed back as the next Needle turn (multi-turn)
  → send_result: single unified platform reply (no duplicates)
```

Needle 3 never sees userId/sessionId/platforms secrets; it receives the
stable prompt head as `system`, the 3 JSON-Schema tools, and the user text
as `query`. Identity always comes from the server-side AppCtx.
`test_command` previews never consume cooldowns; final delivery is always
`send_result`.

## 3. Services

| Service | Content | Deploy |
| ------- | ------- | ------ |
| Service A (Persian-Bot) | `packages/cat-bot` (bot+API), `packages/web` (dashboard), `packages/database` | existing Render service |
| Service B (Needle 3) | standalone Wataru Needle 3 API (`NEEDLE_API_KEY` auth, stateless per request) | `https://wataru-needle-3-api.onrender.com` |

Service B exposes: `GET /health` → `{"ok": true, "model": "needle3",
"generation": 3, "package_version": "3.0.1"}` (503 while degraded),
`POST /v1/complete {query, system?, tools, max_new_tokens?}` → the native
Needle turn dict verbatim (`type / success / error / error_code /
function_calls / suppressed_calls / reasoning / confidence / validation /
prefill_tps / decode_tps / peak_ram_mb`). Auth is `Authorization: Bearer
${NEEDLE_API_KEY}` on every inference call. The service keeps no per-user
session, so Persian-Bot drives multi-turn with a locally-held transcript
(full context in every `query`, stable head in `system`).

## 4. Capability truth (detected live, never hardcoded)

cactus-needle 3.0.1 contains **no MCP and no Skills** implementation.
The probe reports `{toolCalling:true, mcp:false, skills:false}` and
the dashboard renders MCP/Skills as "Not supported by this Needle 3 build"
with no management controls.

## 5. Configuration (Persian-Bot side)

Quick local start: `cp packages/cat-bot/.env.example packages/cat-bot/.env`
(Turso `file:` DB works offline), then `npm run dev -w packages/cat-bot`.
The dev `.env` is gitignored; only `.env.example` is committed. The API key
is never committed — it comes only from the environment / secret storage.

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `NEEDLE_ENABLED` | `false` | master switch (or dashboard toggle) |
| `NEEDLE_URL` | — | Needle service base URL (dashboard: Needle URL) |
| `NEEDLE_API_KEY` | — | Bearer key (dashboard: API key; stored AES-256-GCM, never returned/logged; legacy `NEEDLE_AUTH_TOKEN` still read as fallback) |
| `NEEDLE_MAX_NEW_TOKENS` | `256` | per-request inference budget, forwarded as `max_new_tokens` (1–512) |
| `NEEDLE_TIMEOUT_MS` | `30000` | request timeout (1000–120000; tolerates Render Free cold starts) |
| `NEEDLE_CONFIDENCE_THRESHOLD` | `0.7` | min Needle confidence to execute (0–1; no score → normal authorization path) |
| `NEEDLE_BLOCKED_COMMANDS` | `shell,eval` | additive AI deny-list (canonical names) |
| `NEEDLE_RATELIMIT_PER_USER` / `_PER_SESSION` | `10` / `30` | per-minute AI caps |
| `NEEDLE_MAX_CONCURRENT_PER_SESSION` / `_GLOBAL` | `3` / `10` | concurrency caps |
| `NEEDLE_MAX_COMMANDS_PER_TURN` | `10` | test_command calls per turn |

Dashboard store wins over env; env is the fallback. The bot always boots
with Needle offline (AI gracefully unavailable; everything else unaffected).

## 6. Admin API

```text
GET  /api/v1/admin/ai-agent               settings (key masked → tokenConfigured)
PUT  /api/v1/admin/ai-agent               {enabled, needleUrl, token?, timeoutMs, maxNewTokens, confidenceThreshold}
POST /api/v1/admin/ai-agent/test          real probe (/health + /v1/complete) → {status, capabilities}
GET  /api/v1/admin/ai-agent/capabilities  live detection
```

States: Connected / Disconnected / Unauthorized / Unavailable /
Configuration incomplete / Unsupported / Disabled.

## 7. Security properties

- Guard order mirrors middleware: platform → toggle → admin bypass → bans →
  role (fail-closed) → cooldown. Final execution still passes the real
  dispatcher; permissions/cooldowns/sessions unchanged.
- Deny-list: `shell`/`eval` (+ env additions) can never run via AI.
- Opaque per-turn AI context id bound to (user, platform, session, thread,
  sender, message); cross-user/session/thread reuse rejected; TTL-expired.
- Rate limits + bounded loop (20 turns) + single retry on 5xx only (never
  on 401/4xx, never on timeouts). Timeouts via AbortController.
- No raw AppCtx/DB/platform objects leave the process; results normalized
  (Buffer/stream → sentinels, bigint → string).
- Needle output is never executed as code: only the three registered agent
  tools run, and only through validation → permission → confirmation →
  the existing command dispatcher.

## 8. Tests

- Bot: `npm test` in `packages/cat-bot` — agent loop, guard, catalog,
  schemas, context/result stores, rate limits, needle client incl. the
  verified live `set_brightness({brightness: 30})` shape, unknown-tool,
  permission-denial, invalid-argument, auth/timeout/unavailable and
  multi-call cases.
- `npm run lint`, `npm run build`, `npm run build:web` all pass.
