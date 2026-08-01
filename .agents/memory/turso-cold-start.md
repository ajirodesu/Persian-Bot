---
name: Turso cold-start optimization
description: How bot latency after restart/inactivity was fixed for the Turso adapter.
---

# Turso Cold-Start Optimization

## The rule
After any code or config change touching startup latency, test that the bot platform starts before `syncCommandsAndEvents` and that the LRU pre-warm log appears within 1s of server listen.

**Why:** The main cold-start latency sources were:
1. 2s WS probe timeout on every restart (now 500ms)
2. Full DDL (`executeMultiple` ~250 lines) sent to Turso on every boot — now skipped if `system_admin` table already exists
3. `syncCommandsAndEvents` blocked `platform.start()` — now fires in background after the bot is live
4. LRU cache cold after restart — first middleware chain hit Turso 4–5 times per command; now pre-warmed at startup

**How to apply:**
- Turso client init: `packages/database/adapters/turso/src/client.ts` — schema guard checks `system_admin` table; WS probe capped at 500ms; `TURSO_TRANSPORT` env var caches result across restarts
- Startup sequence: `packages/cat-bot/src/engine/app.ts` — `prewarmCache()` and `syncCommandsAndEvents()` both run as fire-and-forget after `platform.start()`
- LRU: `packages/cat-bot/src/engine/lib/lru-cache.lib.ts` — 5000 entries, 15min TTL
- Heartbeat: 8s for HTTP transport, 25s for WS (WS has own ping/pong)
