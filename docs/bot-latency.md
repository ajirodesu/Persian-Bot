# Cat-Bot latency: restart, idle, and steady state

Author: AjiroDesu

## First, the honest limit

Negative latency and “faster than light” are not achievable: a reply cannot
arrive before the request. The only legitimate version of “negative” is
**precomputation** — doing the work before the request so the visible response
starts from an already-warm state.

This document reports what the process controls (dispatch, cache, startup
ordering) separately from what it does not (database and platform network).

## Before

- Boot loaded commands, sessions and the LRU warm-up, then **waited for the
  pre-warm before connecting the platform gateways**. Time-to-online therefore
  included the DB warm-up.
- The first event in a fresh process paid cold DB reads: **1.0–1.37 s** in the
  benchmark.
- On a cold thread, the ban gate and the admin-only gate each performed their
  own DB read **sequentially**.
- A first slash command per thread after restart waited for a custom-prefix DB
  read even though slash commands cannot use that prefix.
- HTTP keep-alive pools started empty after restart, so the first platform API
  call also paid DNS + TCP + TLS setup.
- Idle refresh existed (10 min) but a suspended process could wake with a
  cache older than the 15-min TTL and dispatch the first message cold.

## Changes

1. **Parallel boot** — `createWarmController` starts the cache warm-up at the
   same time as `platform.start()`. Gateways connect immediately. A message
   that arrives early waits for the same bounded warm-up (8 s max), so the
   first command is still warm but connection setup and warm-up no longer add up.
2. **Inactivity freshness guard** — every message calls `ensureWarm()`. If the
   last successful warm-up is older than 12 min, it refreshes before dispatch;
   otherwise the call is a synchronous no-op. Concurrent warm-ups are coalesced,
   failures back off for 5 s, and a stuck DB cannot make every message wait 8 s.
3. **Idle refresh every 8 min** (below the 15-min LRU TTL), also re-warming the
   platform HTTP connections.
4. **Concurrent security reads** — the ban gate starts the thread admin-box
   read immediately, and the admin-only gate awaits that same in-flight promise.
   The two DB reads overlap instead of stacking. In-flight reads are shared,
   so no duplicate query is issued.
5. **Slash-command prefix fast path** — when the session prefix is `/` and the
   body starts with `/`, the per-thread custom-prefix DB read is skipped for
   this message and resolved in the background for the next text command.
6. **TLS/DNS pre-connect** — best-effort HEAD requests through the shared
   keep-alive agent to `discord.com` and `api.telegram.org` at boot and on the
   idle timer. This removes the cold handshake from the first reply when the
   pool was empty.
7. **Boot observability** — logs now report cache-ready time and listener-wire
   time separately.
8. **Button deadline safety** — button interactions wait at most 2.5 s for the
   warm-up (Discord requires an acknowledgement within 3 s); messages use 8 s.

## Measured

Command: `npm run bench -w packages/cat-bot` (real dispatch pipeline, mock
platform network, local DB/Turso).

| Path | Time |
| --- | ---: |
| Steady-state `/ping` p50 (Discord / Telegram / Webchat) | 0.044 / 0.037 / 0.038 ms |
| Steady-state `/ping` p99 | 0.105 / 0.076 / 0.065 ms |
| Cold first `/ping` — no pre-warm | **1,008–1,365 ms** |
| Warm-up itself | 365–515 ms |
| First `/ping` after warm-up (fresh LRU) | **128–142 ms** (final run 135.8 ms) |
| Remaining first-command cost | one per-sender ban DB read (~135 ms Turso p50) |
| Turso `SELECT 1` floor | p50 127–139 ms (p95 up to ~371 ms) |
| Platform connection floor | Telegram 252 ms–2.2 s; Discord 775 ms–2.2 s |
| Built command discovery (156 files, 348 keys) | ~428–438 ms |

The warm-up is what removes the 1 s cold penalty; the ~135 ms that remains on
the very first message is the authoritative per-sender ban check, which cannot
be skipped or guessed for an unknown sender. After that message, the same
sender/thread hits the LRU and dispatch is sub-millisecond.

## What “negative” would require

- Knowing the sender/thread and their ban/admin state **before** the message
  exists (impossible for a genuinely new sender).
- A DB and platform network with zero RTT (physics/network topology).
- Precomputing every possible user's authorization state (unbounded storage and
  a stale-permission risk).

We do the next best thing: preconnect, prewarm, overlap independent reads, and
keep the caches fresh across idle periods.

## Validation

- `npx tsc --noEmit -p packages/cat-bot/tsconfig.json` — pass
- `npm run lint -w packages/cat-bot` — pass
- `npm test -w packages/cat-bot` — **79/79 pass** (includes 5 warm-controller tests)
- `npm run build -w packages/cat-bot` — pass
- `npm run bench -w packages/cat-bot` — steady-state p99 budget passes
- `npm run bench:startup -w packages/cat-bot` — 156 files / 348 keys, 0 errors

## Files

- `src/engine/lib/warm-controller.lib.ts` — coalescing/freshness/backoff/timeout
- `src/engine/modules/session/session-prewarm.lib.ts` — extracted prewarm
- `src/engine/app.ts` — parallel boot, freshness guard, slash fast path, timers
- `src/engine/lib/http-agent.lib.ts` — TLS/DNS pre-connect
- `src/engine/middleware/on-command.middleware.ts` — concurrent ban/admin reads
- `scripts/bench/latency-bench.ts` — warm-after-cold measurement
- `tests/warm-controller.test.ts`
