# UI/UX audit and design direction

Author: AjiroDesu

## Stack and scope

- React 19 + Vite + TypeScript, Tailwind CSS v4 with a CSS-variable token layer,
  React Router 7, TanStack Query, Socket.IO.
- Surfaces: marketing home, six auth pages, bot manager, chat room, console,
  commands, events, database, bot settings, dashboard settings, create-bot
  wizard, 404/500, admin login/recovery, admin overview, users, bots, files,
  git, settings.
- Reviewed at 375, 768 and 1440 px with `packages/web/scripts/visual-audit.mjs`,
  which renders every route against fixture data and records console errors.

## Audit — what was generic, inconsistent or weak

### Visual system

- **Three competing languages.** The auth/home/shell redesign used an
  ink-and-hairline "telemetry" language, but the chat room, console and database
  still carried the old Stitch/mock palette: `#182533`, `#8b95a2`, `#10b981`,
  gradient logo tiles, `rounded-2xl`/`rounded-xl` (8–12 px) next to 4 px token
  radii. 137 off-token radius classes and ~120 hardcoded hex values.
- **Template shapes.** The chat-room empty state was a centered hero with a
  glowing gradient avatar, four identical 2×2 cards and a full-width CTA —
  exactly the layout the brief bans. The marketing page still advertised
  "three adapters / Fluxer" after the platform was retired.
- **Hierarchy drift.** Dashboard pages used different content widths
  (400/672/768 px), the primary action competed with the page title, and
  freshness/outage state had no visual representation at all.
- **Detail drift.** Platform brand colours lived in ad-hoc arbitrary values;
  console chrome imitated macOS traffic lights; two switch labels overlapped;
  the bot-settings platform field showed React's read-only warning because
  `Field.Root` context overrode the explicit `readOnly` prop.

### UX and states

- Loading was a mix of spinners and skeletons; the auth guard rendered a
  full-screen spinner. A failed revalidation **replaced cached data with an
  error alert** (the bot list explicitly gated rendering on `error === null`).
- There was no persisted "last known state", no stale marker, no in-place
  session recovery, and no widget-level boundary. A backend outage produced an
  offline toast, not a recoverable state.
- Forms kept state in `useState` only: tab switches and reloads lost typed
  values, step and validation. OTP resend had no cooldown, so backgrounding
  could not preserve one.
- Email was a 760 px dark-only glass card built with `system-ui`, no plain-text
  builder, no Reply-To, and no preview/test path.

## Direction — "telemetry printout"

Cat-Bot is an operator console for bots that never sleep, so the interface is a
**printed instrument sheet, not a dashboard of cards**: ink-black paper,
hairline rules, condensed signage headings, a neutral grotesque for reading,
and mono for every datum. One emerald accent is reserved for the single primary
action, focus, live state and identity — never decoration. Corners are 4 px,
surfaces are flat (no resting shadows, gradients, blur or glow), and hierarchy
comes from type scale, rules and alignment rather than elevation. The signature
move is the **ruled ledger**: numbered ordinal rows, metadata ledgers and mono
micro-labels repeat from the marketing index to the bot console and the
transactional emails. Motion only explains state (route progress, banner
recovery, dialog entry, streaming logs) and respects
`prefers-reduced-motion`.

Dark is the only interface mode (project rule); the palette is tuned one step
lighter than pure ink to reduce glare, and neutrals were raised so 10–11 px
micro-labels meet WCAG AA (4.5:1) — Lighthouse accessibility is 100.

## What changed, by audit finding

| Audit finding | Resolution |
| --- | --- |
| Off-token radii across 137 classes | All corners now resolve to `--radius-card`, `--radius-card-lg`, `--radius-button`, `--radius-input`, `--radius-badge`, `--radius-compact`. |
| Hardcoded UI colours | Removed from components; platform hues live in `--platform-discord` / `--platform-telegram` utilities, theme dots in `--accent-jasper` / `--accent-amethyst`. Remaining literals are the metadata `theme-color` and email tokens. |
| Chat room hero/2×2 card template | Rebuilt as a ruled handshake sheet: eyebrow + rule, display headline, one primary action, numbered capabilities ledger. Console dropped the fake macOS traffic lights. |
| Stale Fluxer copy | Home now states two adapters; all web references removed with the platform. |
| Inconsistent page widths | Bot manager, console, commands, events and settings share the content max-width and padding tokens; chat room owns a document column. |
| Cached data replaced by errors | Dashboard hooks keep `data` on failed revalidation; lists render whenever data exists and show `FreshnessNote`; error alerts only appear when there is nothing cached. |
| Full-screen spinner guard | Shell-shaped skeleton matching the dashboard geometry. |
| Offline toast / no recovery | `ConnectionBanner` + `ConnectivityContext`: offline, server unavailable, recovering, restored; last-saved clock and Retry now. |
| Auth form resets | Versioned draft persistence (`useFormDraft`) for login, signup, verification, forgot/reset and admin login; passwords and OTPs never stored; deadline-based cooldowns. |
| Session expiry redirect | In-place re-auth dialog over the preserved dashboard, returning to the same URL. |
| Dark-only email with no fallback | Token-driven 600 px table email: light-first, real dark mode (`prefers-color-scheme` + `[data-ogsc]`), plain-text alternative, preheader, one CTA + link fallback, Reply-To. |
| No verification tooling | Visual audit harness, resilience walkthrough, 57 unit tests, Lighthouse runs, email preview + screenshots. |

## Verification

- Screenshots: `docs/design-review/` (preview + admin, 375/768/1440).
- Lighthouse (production build, mobile): home 88/100/100, login 89/100/100
  (performance / accessibility / best-practices), CLS ≤ 0.001.
- Details and trade-offs: `docs/resilience-verification.md`.
