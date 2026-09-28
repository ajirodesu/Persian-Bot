# Persian-Bot AI Agent — Cactus Needle 3 + Cat-Bot architecture

## 1. Rule

```text
Cactus Needle 3 = AI brain (separately hosted, decides the tool call)
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
  → Needle 3 client (HTTPS + Bearer → Needle service /v1/agent/complete)
  → Needle 3 tool call (help | test_command | send_result)
  → executed LOCALLY with the authenticated AppCtx
  → help: catalogue detail · test_command: guard + dispatcher + capture
  → tool-result JSON fed back as the next Needle turn (multi-turn)
  → send_result: single unified platform reply (no duplicates)
```

Needle 3 never sees userId/sessionId/platforms secrets; it receives the
rendered system prompt + 3 JSON-Schema tools + user text. Identity always
comes from the server-side AppCtx. `test_command` previews never consume
cooldowns; final delivery is always `send_result`.

## 3. Services

| Service | Content | Deploy |
| ------- | ------- | ------ |
| Service A (Persian-Bot) | `packages/cat-bot` (bot+API), `packages/web` (dashboard), `packages/database` | existing Render service |
| Service B (Needle 3) | `needle-service/` (`app.py` stdlib adapter around official `cactus-needle==3.0.1`, generation 3) | `needle-service/Dockerfile` + `render.yaml`, health check `/health` |

Service B exposes: `GET /health`, `GET /capabilities`,
`POST /v1/agent/complete`, `POST /v1/agent/reset` — all (except `/health`)
Bearer-authenticated. One stateful `Needle` instance per Persian AI session
id (TTL-bounded); tool retrieval is engine-side (top-5/turn over 5 tools).

## 4. Capability truth (detected live, never hardcoded)

cactus-needle 3.0.1 contains **no MCP and no Skills** implementation.
`GET /capabilities` reports `{toolCalling:true, mcp:false, skills:false}` and
the dashboard renders MCP/Skills as "Not supported by this Needle 3 build"
with no management controls.

## 5. Configuration (Persian-Bot side)

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `NEEDLE_ENABLED` | `false` | master switch (or dashboard toggle) |
| `NEEDLE_URL` | — | Needle service base URL (dashboard: Needle URL) |
| `NEEDLE_AUTH_TOKEN` | — | Bearer secret (dashboard: token; stored AES-256-GCM, never returned/logged) |
| `NEEDLE_TIMEOUT_MS` | `30000` | request timeout (1000–120000) |
| `NEEDLE_CONFIDENCE_THRESHOLD` | `0.7` | min Needle confidence to execute (0–1; no score → normal authorization path) |
| `NEEDLE_BLOCKED_COMMANDS` | `shell,eval` | additive AI deny-list (canonical names) |
| `NEEDLE_RATELIMIT_PER_USER` / `_PER_SESSION` | `10` / `30` | per-minute AI caps |
| `NEEDLE_MAX_CONCURRENT_PER_SESSION` / `_GLOBAL` | `3` / `10` | concurrency caps |
| `NEEDLE_MAX_COMMANDS_PER_TURN` | `10` | test_command calls per turn |

Dashboard store wins over env; env is the fallback. The bot always boots
with Needle offline (AI gracefully unavailable; everything else unaffected).

## 6. Admin API

```text
GET  /api/v1/admin/ai-agent               settings (token masked → tokenConfigured)
PUT  /api/v1/admin/ai-agent               {enabled, needleUrl, token?, timeoutMs, confidenceThreshold}
POST /api/v1/admin/ai-agent/test          real authenticated probe → {status, capabilities}
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
- Rate limits + bounded loop (20 turns) + single retry on transient errors
  only (never on 401/4xx). Timeouts via AbortController.
- No raw AppCtx/DB/platform objects leave the process; results normalized
  (Buffer/stream → sentinels, bigint → string).

## 8. Tests

- Bot: `npm test` in `packages/cat-bot` — 70 vitest tests (agent loop,
  guard, catalog, schemas, context/result stores, rate limits, needle
  client incl. refusal/suppressed/low-confidence/401/timeout/malformed).
- Needle service: `python3 test_adapter.py` in `needle-service/` — 7 stdlib
  tests (auth, validation, multi-turn state reuse, capabilities truth).
- `npm run lint`, `npm run build`, `npm run build:web` all pass.
