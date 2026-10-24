# Dashboard resilience, auth persistence and email verification

Author: AjiroDesu

## Audit — root cause of each failure

### a) Backend stopped while the dashboard is open / on a fresh load

- **Cached data was discarded by the view.** `BotManagerPage` and
  `BotLayout` gated rendering on `error === null` and replaced the list with an
  error alert — even though TanStack still held the last successful data.
- **The cache was memory-only.** `QueryClient` had `gcTime` but no persistence,
  so a reload during downtime had nothing to render and fell through to the
  error path.
- **The guard treated "unknown" as "signed out".** A failed `get-session` made
  `isAuthenticated` false and redirected to `/login`, destroying context.
- **No outage affordance.** A transient socket disconnect raised a sticky
  "You are currently offline" snackbar; REST failures only hit `console.error`.

### b) Long idle, token expiry, sleeping tab

- No proactive refresh before `expiresAt` and no wake-time check; the first
  request after idle could 401.
- A 401 was not distinguishable from a network failure at the UI layer; there
  was no in-place re-auth, so the guard redirected.
- `getSocket()` recreated the Socket.IO instance whenever it was disconnected,
  orphaning every listener registered by hooks. Reconnect therefore did not
  resync status/logs until a reload.
- No connectivity heartbeat, no pause-on-hidden policy, and no global handler
  for unhandled promise rejections.

### c) Login / create-account state loss

- Every field, step and error lived in component `useState`; nothing was
  persisted. Reloads, mobile tab discards and app switches reset the form.
- No draft contract existed, so the password field could not be deliberately
  excluded (`sensitive` denylist) and the OTP cooldown was not timestamp-based.
- Submits had no synchronous lock; a double click/Enter repeat could fire two
  requests.

### d) Transactional email

- 760 px dark-only frosted card, `system-ui`, comments referring to a deleted
  `aqua.css`, no plain-text builder at the layout level, no preheader/Reply-To,
  no `prefers-color-scheme` baseline for light-default clients, no preview or
  tests. Five call sites each re-implemented the body copy and colors.

## What was implemented

### Request layer (`lib/api-client.lib.ts`, `api-error.lib.ts`)

- Classified failures: `aborted | timeout | offline | network | http | parse`,
  with status-aware user copy (`apiErrorMessage`).
- 20 s timeout, composed abort signal, credential cookies, JSON parse guard.
- In-flight GET deduplication for imperative callers; TanStack dedupes queries.
- `Retry-After` parsed into `retryAfterMs`; 401 on non-auth endpoints emits
  `catbot:auth-required`, while connectivity events report reachability.

### Cache and retry (`query-client.lib.ts`, `query-persistence.lib.ts`, `retry.lib.ts`)

- Persisted `bots`/`admin` query data (versioned, 7-day TTL, quota-safe,
  1.5 MB budget) restored synchronously **before React mounts**.
- Serializer keeps **error-with-data** states — this was a real bug found by the
  walkthrough: a failed refresh used to overwrite the stored payload and drop
  the last known list.
- Retry: exponential backoff, ±25 % jitter, 30 s cap, max 5 attempts,
  `Retry-After` wins; 400/401/403/404/409/422 never retry.
- Mutations never auto-retry (duplicate-write safety).

### Live status (`ConnectivityContext`, `ConnectionBanner`)

- Phases: offline / server unavailable / reconnecting / restored, with the last
  synced clock and one manual recovery action.
- Retries immediately on `online`, tab visible, window focus; pauses the
  heartbeat when hidden; disconnects the socket after five hidden minutes.
- Socket singleton is never recreated; hooks resync status snapshots and log
  history on every `connect`.

### Sessions (`UserAuthContext`, `UserProtectedRoute`, `ReauthModal`)

- Silent refresh 60 s before expiry and on wake within five minutes.
- 401 → confirm with `getSession`; if expired, render the re-auth dialog over
  the preserved route (no navigation), then invalidate queries after sign-in.
- Only the display name/email of the last user is stored; tokens and passwords
  never are. Logout clears the cache, drafts and identity.
- Guard: shell skeleton while checking, dashboard with local context during an
  outage, redirect only when there is genuinely no context.

### Errors and forms

- Route boundary + page-level widget boundary (shell and navigation survive a
  page crash), inline retry fallback.
- Global `error`/`unhandledrejection` bridge with throttled, non-alarming
  feedback; aborted requests ignored.
- `useFormDraft` (versioned, debounced, pagehide-flushed, secret denylist)
  applied to login, signup, verification, forgot/reset and admin login.
- OTP/resend cooldowns stored as absolute deadlines (`useCountdown`), so a
  frozen interval cannot drift. Passwords/OTPs remain memory-only.
- Synchronous submit locks; successful submit clears the draft; explicit
  "use a different email" clears it too.

### Email (`server/email-template/index.ts`)

- `EMAIL_TOKENS` (colour, type, spacing, radius, width), one table-based shell:
  masthead, eyebrow, heading, code block, one CTA + plain-link fallback,
  security note, footer with support link.
- Light-first palette + `prefers-color-scheme: dark` + `[data-ogsc]`; 600 px
  max width; mobile media query; MSO font fallback; no images.
- `buildVerificationEmail` / `buildPasswordResetEmail` for user and admin
  scopes; every call site now uses them. Plain-text is generated per template.
- Reply-To added to the Brevo request (`BREVO_REPLY_TO`, defaulting to the
  verified sender); subjects are specific and non-promotional.
- `preview:emails` writes HTML + `.txt` + index; `preview:emails:shots` renders
  light/dark at 375/1200 px for all four templates.
- 30 tests enforce table layout, token-only colours, dark-mode hooks, escaping,
  no images, one CTA, expiry copy, support contact and plain text.

### Fluxer

The retired platform was removed end to end: adapter tree (22 files), command
and event platform arrays, connect flow, credential/admin branches, DB
migration mapping, web platform tabs and copy, docs, and the `@fluxerjs/core`
dependency. Platform id `4` remains documented as retired and is never reused.
`grep -ri fluxer` over the source tree returns nothing; only these audit notes
mention the removal.

## Verification matrix

Automated walkthrough: `node packages/web/scripts/resilience-check.mjs` — 14/14
checks pass.

| Scenario | Expected | Result |
| --- | --- | --- |
| Login email typed, reload | Email restored, password empty, absent from storage | PASS |
| Backend killed while open (offline event + failed requests) | Data stays, banner appears, no crash page | PASS |
| Backend recovers | Banner clears automatically, data refreshes | PASS |
| Backend down on fresh load | Persisted data renders, outage explained, no error page | PASS |
| Manual "Retry now" after recovery | Data refreshes in place | PASS |
| Confirmed 401 | In-place re-auth modal, URL unchanged, data still visible | PASS |
| Cache serializer during failed refresh | Last known list is retained (regression test) | PASS |

Unit tests: **57** (web 27, cat-bot 30).

Commands:

```sh
# app (two terminals)
npm run dev -w packages/cat-bot
npm run dev:web

# UI screenshots at 375/768/1440 (fixtures, console captured)
node packages/web/scripts/visual-audit.mjs

# failure-mode walkthrough (real UI, intercepted API)
node packages/web/scripts/resilience-check.mjs

# tests / types / lint
npx vitest run -w packages/web
npx vitest run -w packages/cat-bot
npx tsc -b packages/web
npx tsc --noEmit -p packages/cat-bot
npm run lint -w packages/web
npm run lint --workspaces --if-present

# email previews
npm run preview:emails -w packages/cat-bot
npm run preview:emails:shots -w packages/cat-bot
```

Lighthouse, production build (`npm run build -w packages/web`, served on the
API origin), mobile emulation:

| Page | Performance | Accessibility | Best practices | LCP | CLS |
| --- | --- | --- | --- | --- | --- |
| `/` | 88 | 100 | 100 | 3.3 s | 0 |
| `/login` | 89 | 100 | 100 | 3.2 s | 0.001 |

(Lighthouse 13, Chrome 153 headless; reports in `docs/design-review/`.)

## Limitations and trade-offs

- **A full page reload cannot resume an in-flight HTTP request** — the request
  is owned by the discarded document. Tab/app switches and SPA navigation keep
  it; a reload keeps the draft and clears the submitting state. Signup
  duplicate protection relies on the server's unique email plus the client
  double-submit lock.
- **OTP values are deliberately not persisted** (they are secrets). Email/step/
  resend deadline survive; after a tab discard the user re-enters the code.
- **Admin forgot/reset pages** still use in-memory state; the primary
  user-facing login, signup and recovery flows plus admin login are persisted.
- **Realtime verification**: the walkthrough runs without a real account, so it
  aborts Socket.IO. Reconnect behaviour is implemented (singleton, connect
  resync, visibility pause) and covered structurally, but not exercised against
  a live authenticated socket in this pass.
- **Email clients were emulated, not installed.** Rendering was verified in
  Chrome at both colour schemes and widths; the markup follows table/inline
  patterns for Gmail/Outlook/Apple Mail, but a manual client pass before a
  production send is still prudent.
- **LCP ≈ 3.2–3.3 s** on simulated mobile against a local single-process server.
  Fonts are preloaded and self-hosted; an edge cache/CDN would move this into
  the "good" band.
- **Local cache is per browser.** It contains the signed-in user's dashboard
  data. Explicit logout clears it; a naturally expired session preserves it by
  design (with an in-place re-auth prompt), which is a deliberate availability
  vs. shared-device trade-off.
