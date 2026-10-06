<!-- Screenshot index for the Persian-Bot web dashboard. -->

# Web Screenshots

All screenshots below are real captures of this repo's web dashboard
(`packages/web`, default Aqua dark theme, desktop 1440×900), taken against a
local dev stack (API + Vite) signed in as the seeded admin account
(`admin@example.com`, via `npm run seed:admin -w packages/cat-bot`).

Files live in [`./screenshots/`](./screenshots/).

## Public pages (no sign-in)

| Route | File |
|---|---|
| `/` landing | `screenshots/public-home.png` |
| `/login` | `screenshots/public-login.png` (+ filled form: `public-login-filled.png`) |
| `/signup` | `screenshots/public-signup.png` |
| `/forgot-password` | `screenshots/public-forgot-password.png` |
| `/reset-password` | `screenshots/public-reset-password.png` |
| `/account-verification` | `screenshots/public-account-verification.png` |
| unknown route (404) | `screenshots/public-404.png` |

## User dashboard (`/dashboard`, signed in)

| Route | File |
|---|---|
| `/dashboard` bot manager (empty state — this account owns no bots) | `screenshots/dashboard-manager.png` |
| `/dashboard/settings` profile, theme, timezone, security, danger zone | `screenshots/dashboard-settings.png` |
| `/dashboard/create-new-bot` step 1 Identity | `screenshots/dashboard-create-new-bot-identity.png` |
| `/dashboard/create-new-bot` step 2 Platform, Discord selected | `screenshots/dashboard-create-new-bot-platform-discord.png` |
| `/dashboard/create-new-bot` step 2 Platform, Telegram selected | `screenshots/dashboard-create-new-bot-platform-telegram.png` |
| `/dashboard/create-new-bot` step 2 Platform, Fluxer selected | `screenshots/dashboard-create-new-bot-platform-fluxer.png` |
| `/dashboard/chat-room` welcome panel | `screenshots/dashboard-chat-room-welcome.png` |
| `/dashboard/chat-room` live chat UI (after Get Started) | `screenshots/dashboard-chat-room.png` |
| `/dashboard/bot?id=<unknown>` not-found state | `screenshots/dashboard-bot-not-found.png` |

> **Bot detail tabs** (`/dashboard/bot`, `/commands`, `/events`, `/database`
> with its Users/Groups tabs, `/settings`) render only for a bot session owned
> by the signed-in account. The screenshot account owns no bots and bot
> credentials require live platform verification, so these tabs are represented
> here by the genuine `dashboard-bot-not-found.png` gate state. Re-run
> `node shots.js` (see below) with an account that owns a running bot to fill
> in `dashboard-bot-console.png`, `dashboard-bot-commands.png`,
> `dashboard-bot-events.png`, `dashboard-bot-database-users.png`,
> `dashboard-bot-database-groups.png`, and `dashboard-bot-settings.png`
> — the script captures them automatically when `GET /api/v1/bots` returns one.

## Admin portal (`/admin`, signed in as admin)

| Route | File |
|---|---|
| `/admin` sign-in | `screenshots/admin-login.png` (+ filled: `admin-login-filled.png`) |
| `/admin/forgot-password` | `screenshots/admin-forgot-password.png` |
| `/admin/reset-password` | `screenshots/admin-reset-password.png` |
| `/admin/dashboard` totals, platform distribution, recent registrations | `screenshots/admin-dashboard-overview.png` |
| `/admin/dashboard/users` search + row actions (Ban/Edit/Delete) | `screenshots/admin-dashboard-users.png` |
| … with Edit User dialog open | `screenshots/admin-dashboard-users-edit-dialog.png` |
| `/admin/dashboard/bots` platform groups + session rows | `screenshots/admin-dashboard-bots.png` |
| … with Delete Bot Session dialog open | `screenshots/admin-dashboard-bots-delete-dialog.png` |
| `/admin/dashboard/git` repo status, commit/push/pull, changes, history | `screenshots/admin-dashboard-git.png` |
| `/admin/dashboard/files` file browser | `screenshots/admin-dashboard-files.png` |
| `/admin/dashboard/files/edit?path=package.json` code editor | `screenshots/admin-dashboard-file-editor.png` |
| `/admin/dashboard/settings` profile, theme, timezone, admins, maintenance, git, security, danger zone | `screenshots/admin-dashboard-settings.png` |

Dialog captures were opened and dismissed with `Escape` — nothing was
submitted, and no data was modified during the pass.

## Re-taking them

The capture script lives outside the repo at `/tmp/opencode/shots/shots.js`
(kept out of git on purpose; asks for nothing — credentials are the seeded
admin's). With the API on `:3001` and Vite proxying to it on `:5000`:

```
node /tmp/opencode/shots/shots.js   # full pass → docs/screenshots/
node /tmp/opencode/shots/wizard.js  # create-new-bot platform steps only
```

> The committed shots show the other accounts/rows already present in the
> shared dev database at capture time. If that data is sensitive, re-take the
> admin captures against a fresh database before publishing.
