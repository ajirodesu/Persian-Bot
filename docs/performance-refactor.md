# Command modularization, dead-code removal and latency report

Author: AjiroDesu

Baseline: `d875fa8` (clean working tree). All measurements below were taken on
this machine, against that baseline in a detached worktree with the identical
harness.

## 1. Architecture changes

### Command discovery and registration

`packages/cat-bot/src/app/commands/` contains **156 files**, each registering
exactly **one** canonical command (`meta` + handler, optionally `button` /
lifecycle hooks). There are no production `commands: [...]` families and no
file with more than one `meta` export; `tests/commands/registration.test.ts`
enforces both.

The loader (`command-loader.lib.ts`) was hardened:

- scans files in sorted order, then imports them concurrently;
- registers only after the import batch, so names/aliases/log order are
  deterministic across filesystems;
- clones and normalises `meta` (name, aliases, option names) instead of
  mutating the imported ES module;
- detects duplicate canonical names and aliases, logs both file names and
  skips the later entry instead of silently overwriting;
- reports actionable per-file diagnostics (missing meta, missing handler,
  import failure) through `loadCommandsWithDiagnostics`, while the existing
  `loadCommandsFromDirectory` interface stays compatible for `app.ts`;
- keeps the legacy `commands` family shape for third-party packs (covered by
  fixtures), but no repository command uses it.

Build output is now cleaned before compilation (`clean` + `build` scripts for
`cat-bot` and `database`). This fixed a real production-local issue: a stale
`dist` contained 74 deleted command modules, which the loader previously
silently overwrote or double-registered. A clean build registers
**156 canonical / 348 keys / 0 errors**.

### Dispatch hot path

- One module per canonical command; lookup remains an O(1) `Map.get` on
  canonical names and aliases.
- `onChat` now uses a WeakMap index of modules that actually implement it,
  filtered per platform. The previous code walked every alias key on every
  message.
- Command enable/disable state uses a per-cached-list `Map<name, boolean>`
  instead of a linear scan over every session command row per dispatch.
- Suggestions pre-compute canonical names and their bigram profiles once per
  `CommandMap`; scoring is a single running-max pass (no ratings array, no
  sort, no alias traversal).
- Parser uses index-based token slicing (one `slice`, no copy + two `shift`s).
- `OptionsMap.empty()` is a real singleton; previously it allocated a Map per
  command.
- Middleware fast paths are synchronous where no async work is needed
  (permission ANYONE, cooldown checks, free payment, option parsing,
  maintenance-off, cached ban/role gates). The chain runner still waits for
  `next()` even when a sync guard does not return it.
- Hot-path `logger.debug` calls are gated by one process-level level check.
- Synchronous cache peeks (`peekUserBanned`, `peekThreadBanned`,
  `peekBotAdmin`, `peekSystemAdmin`, `peekMaintenanceModeEnabled`,
  `peekDiscordServerIdByChannel`) let the ban/maintenance guards answer from
  warm LRUs without allocating promises.

## 2. Command migration

| Item | Count |
| --- | --- |
| Commands identified (canonical) | 156 |
| Modules on arrival | 156 (one command each) |
| Modules after refactor | 156 (one command each) |
| Multi-command production modules | 0 |
| Multi-command test fixtures (compatibility) | 1 (`multi.command.js`) |
| Metadata fields/aliases preserved | 156 / 192 unique aliases |
| Remaining exceptions | 0 |

The pre-refactor commit had already split the command files; this pass verified
the split, added loader diagnostics/duplicate protection, and locked the
inventory with tests. `tests/fixtures/command-inventory.json` is the frozen
metadata snapshot; `registration.test.ts` fails if any name, alias, metadata
field, button family or lifecycle hook changes.

## 3. Cleanup performed

**Removed dead exports/functions**

- `perfTraceEnabled` (unused wrapper; `perfMark` keeps the internal flag)
- `registerTypingStopper` (unused public wrapper)
- `ApiName` (unused type alias)
- `getStoredGitHubIdentity` (unused repo getter)
- `LogMessageTypeValue`, `AttachmentTypeValue`, `EventTypeValue` (unused types)
- `validateOptions` (unused; `parseTextOptions` is the live path)
- `getPathLastCommit` (unused git helper)
- unused `OptionType` import in `randomperiodictable.ts`
- unused `forkOwner`/`forkRepo`/`upstreamRepo` parameters in `findMergeBase`

**Removed dead UI**

- `components/ui/ThemeToggle.tsx`
- `components/layout/AppHeader.tsx`
- `components/ui/data-display/ScrollArea.tsx`
- `components/ui/data-display/Status.tsx`
- `components/ui/data-display/Stat.tsx`
- `useBotDatabaseGroups` + its return interface (~230 lines, no callers)
- unused route prefetchers (`prefetchBotConsole`, `prefetchBotCommands`)
- unused socket helpers (`disconnectSocket`, `isSocketConnected`)
- unused constant `H_SIDEBAR_ICON`
- unused `getPlatformColors`
- 15 unused component prop-type aliases were made local (no public consumers)

`tsc --noUnusedLocals --noUnusedParameters` is clean in cat-bot, database and
web.

**Dependencies**

- Removed `lighthouse` from `packages/web` (no script referenced it; 107
  transitive packages dropped from `node_modules`).
- Moved `@libsql/kysely-libsql` from the Turso adapter (which never imported
  it) to `packages/cat-bot`, the workspace that imports `LibsqlDialect`.
- All remaining declared dependencies were checked against real imports/scripts.

**Build hygiene**

- `clean` scripts for cat-bot/database, deleting stale `dist` output before
  compile. This removed 74 obsolete compiled commands that were being loaded
  twice and eliminated 74 duplicate-registration warnings.

## 4. Performance

Harness: `npm run bench -w packages/cat-bot`, identical on baseline and after.
Local file DB (`DATABASE_TYPE=turso`, `file:` URL), mocked platform API, 200
warmups + 1000 timed iterations per case/platform, 3 runs; table shows the
median of the three runs. Values are **milliseconds of local processing**;
Discord/Telegram network calls are excluded (they are reported separately by
the bench, 0.25–0.77 s connection floor in this environment).

### Ping — success path

| Platform | p50 before | p50 after | p95 before | p95 after | p99 before | p99 after | p95 change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Discord | 0.084 | 0.058 | 0.163 | 0.101 | 0.277 | 0.151 | **−38.0%** |
| Telegram | 0.065 | 0.037 | 0.100 | 0.054 | 0.217 | 0.077 | **−46.0%** |
| Webchat | 0.064 | 0.038 | 0.093 | 0.051 | 0.217 | 0.069 | **−45.2%** |

Average p95 across platforms: **0.119 ms → 0.069 ms (−42%)**.
Local throughput (mock network, one command at a time): **~16k–26k dispatches/s**
depending on platform.

### Unknown command — suggestion path

| Platform | p50 before | p50 after | p95 before | p95 after | p95 change |
| --- | --- | --- | --- | --- | --- |
| Discord | 0.295 | 0.088 | 0.446 | 0.114 | **−74.4%** |
| Telegram | 0.287 | 0.085 | 0.369 | 0.112 | **−69.6%** |
| Webchat | 0.285 | 0.088 | 0.366 | 0.147 | **−59.8%** |

`findSimilarCommand` alone: **0.235 ms → 0.060 ms per call (~74% faster)** over
a 349-entry map.

### Plain chatter (no command)

| Platform | p95 before | p95 after | Change |
| --- | --- | --- | --- |
| Discord | 0.058 | 0.028 | −51.7% |
| Telegram | 0.025 | 0.016 | −36.0% |
| Webchat | 0.029 | 0.020 | −31.0% |

### Startup and environment

- Built artifact startup (`bench:startup`, clean `dist`): **156 canonical /
  348 keys, 407 ms cold, 3.6 ms warm, 0 errors, +35.5 MB heap**.
  Baseline built artifact: 416.8 ms cold, 3.4 ms warm, +35 MB. Cold startup is
effectively unchanged (run-to-run noise): it is dominated by evaluating 156 modules and their
  shared dependencies, not by the loader. No lazy loading was introduced
  because it would move the cost into the first user command.
- Event loop during the steady-state benchmark: p50 ~10 ms (10 ms monitor
  resolution), p95 10.1–11.1 ms, max 118–128 ms (startup/GC spikes). Per-command
  work is sub-millisecond; the max is not on the dispatch path.
- Local DB `SELECT 1`: p50 ~0.02 ms. Platform connection floors measured at
  252–640 ms p50 and are excluded from the dispatch figures.

## 5. Validation

| Command | Result |
| --- | --- |
| `npm test -w packages/cat-bot` | **74/74 passed** (8 files) |
| `npm run lint --workspaces --if-present` | cat-bot, web pass (database has no lint script) |
| `npx tsc --noEmit -p packages/cat-bot` | 0 errors |
| `npx tsc --noEmit -p packages/database` | 0 errors |
| `npx tsc -b packages/web` | 0 errors |
| `npm run build` (cat-bot + database) | pass |
| `npm run build -w packages/web` | pass |
| `npm run bench -w packages/cat-bot` | PASS, p99 budget 10 ms |
| `npm run bench:startup -w packages/cat-bot` | 0 errors, stable registration |
| `tsc --noUnusedLocals --noUnusedParameters` (bot/db/web) | 0 errors |

Tests added: loader determinism/collision/clone tests (3), parser/suggestion
parity/onChat index/OptionsMap tests (11), middleware runner/fast-path tests
(6). The inventory test verifies 156 canonical commands, unique names, 192
aliases, metadata, hooks and button families.

## 6. Remaining issues and trade-offs

- **Cold startup is unchanged (~418 ms built).** It is module-evaluation bound
  (156 command modules plus shared Discord/Telegram/DB code). Lazy command
  loading was rejected because it adds first-command latency; a static
  build-time command manifest could be evaluated later if startup becomes a
  product requirement.
- The legacy `commands: [...]` loader shape remains for third-party packs
  (fixture-tested). No production module uses it.
- **No live Discord/Telegram session test** was run (no credentials in this
  environment). Platform routing is covered by metadata/platform-filter tests
  and the mocked dispatch benchmark; network latency is reported separately.
- The benchmark measures local processing with a mocked API and a local file
  DB. Remote DB/platform latency is external and environment-dependent.
- Discord's thread-ban fast path still requires the channel→server mapping to
  be warm; a cold mapping falls back to the existing async path.
- The web UI is unchanged functionally; only dead components/exports were
  removed.

## 7. Main changed paths

- Command infra: `src/engine/modules/command/{command-loader,command-parser,command-suggest}.util|lib.ts`,
  `src/engine/modules/options/options-map.lib.ts`,
  `src/engine/modules/session/bot-session-commands.repo.ts`,
  `src/engine/controllers/on-chat-runner.ts`,
  `src/engine/lib/middleware.lib.ts`,
  `src/engine/middleware/on-command.middleware.ts`,
  cache peeks in `repos/{banned,credentials,system-admin,maintenance-mode,threads}.repo.ts`.
- Tests: `tests/commands/{loader,dispatch-utils,middleware}.test.ts`.
- Benchmark: `scripts/bench/latency-bench.ts`, new `scripts/bench/startup-probe.mjs`,
  `package.json` (`bench:startup`, `clean`).
- Cleanup: deleted web components listed above; removed the dead exports/types
  and dependency declarations.
