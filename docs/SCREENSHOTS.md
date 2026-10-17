<!-- Screenshot index for the Persian-Bot web dashboard. -->

# Web Screenshots

All screenshots below are real captures of this repo's web dashboard
(`packages/web`, default Aqua dark theme, desktop 1440×900), taken against a
local dev stack (API + Vite) signed in as the seeded admin account
(`admin@example.com`, via `npm run seed:admin -w packages/cat-bot`).

Files live in [`./screenshots/`](./screenshots/).

## Public pages (no sign-in)

### Landing — `/`

![Landing page](./screenshots/public-home.png)

### Sign in — `/login`

Empty form:

![Sign-in page](./screenshots/public-login.png)

With the form filled in:

![Sign-in page with the form filled in](./screenshots/public-login-filled.png)

### Sign up — `/signup`

![Sign-up page](./screenshots/public-signup.png)

### Forgot password — `/forgot-password`

![Forgot-password page](./screenshots/public-forgot-password.png)

### Reset password — `/reset-password`

![Reset-password page](./screenshots/public-reset-password.png)

### Account verification — `/account-verification`

![Account-verification page](./screenshots/public-account-verification.png)

### Unknown route — 404

![Not-found page](./screenshots/public-404.png)

## User dashboard (`/dashboard`, signed in)

### Bot manager — `/dashboard`

Empty state — this account owns no bots.

![Bot manager, empty state](./screenshots/dashboard-manager.png)

### Settings — `/dashboard/settings`

Profile, theme, timezone, security, danger zone.

![Dashboard settings](./screenshots/dashboard-settings.png)

### Create a bot — `/dashboard/create-new-bot`

Step 1, identity:

![Create-new-bot step 1: identity](./screenshots/dashboard-create-new-bot-identity.png)

Step 2, platform — Discord selected:

![Create-new-bot step 2: platform with Discord selected](./screenshots/dashboard-create-new-bot-platform-discord.png)

Step 2, platform — Telegram selected:

![Create-new-bot step 2: platform with Telegram selected](./screenshots/dashboard-create-new-bot-platform-telegram.png)

Step 2, platform — Fluxer selected:

![Create-new-bot step 2: platform with Fluxer selected](./screenshots/dashboard-create-new-bot-platform-fluxer.png)

### Chat room — `/dashboard/chat-room`

Welcome panel:

![Chat room welcome panel](./screenshots/dashboard-chat-room-welcome.png)

Live chat UI after _Get Started_:

![Chat room live UI](./screenshots/dashboard-chat-room.png)

### Bot detail — `/dashboard/bot?id=<unknown>`

Not-found gate state (see the note below):

![Bot detail not-found state](./screenshots/dashboard-bot-not-found.png)

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

### Sign in — `/admin`

Empty form:

![Admin sign-in page](./screenshots/admin-login.png)

With the form filled in:

![Admin sign-in page with the form filled in](./screenshots/admin-login-filled.png)

### Forgot password — `/admin/forgot-password`

![Admin forgot-password page](./screenshots/admin-forgot-password.png)

### Reset password — `/admin/reset-password`

![Admin reset-password page](./screenshots/admin-reset-password.png)

### Overview — `/admin/dashboard`

Totals, platform distribution, recent registrations.

![Admin dashboard overview](./screenshots/admin-dashboard-overview.png)

### Users — `/admin/dashboard/users`

Search + row actions (Ban/Edit/Delete):

![Admin users list](./screenshots/admin-dashboard-users.png)

Edit User dialog open:

![Admin users list with the Edit User dialog open](./screenshots/admin-dashboard-users-edit-dialog.png)

### Bots — `/admin/dashboard/bots`

Platform groups + session rows:

![Admin bots list](./screenshots/admin-dashboard-bots.png)

Delete Bot Session dialog open:

![Admin bots list with the Delete Bot Session dialog open](./screenshots/admin-dashboard-bots-delete-dialog.png)

### Git — `/admin/dashboard/git`

Repo status, commit/push/pull, changes, history.

![Admin git page](./screenshots/admin-dashboard-git.png)

### Files — `/admin/dashboard/files`

File browser:

![Admin file browser](./screenshots/admin-dashboard-files.png)

Code editor (`/admin/dashboard/files/edit?path=package.json`):

![Admin file editor](./screenshots/admin-dashboard-file-editor.png)

### Settings — `/admin/dashboard/settings`

Profile, theme, timezone, admins, maintenance, git, security, danger zone.

![Admin settings](./screenshots/admin-dashboard-settings.png)

Dialog captures were opened and dismissed with `Escape` — nothing was
submitted, and no data was modified during the pass.

## Re-taking them

The capture script lives outside the repo at `/tmp/opencode/shots/shots.js`
(kept out of git on purpose; asks for nothing — credentials are the seeded
admin's). With the API on `:3001` and Vite proxying to it on `:5000`:

```bash
node /tmp/opencode/shots/shots.js   # full pass → docs/screenshots/
node /tmp/opencode/shots/wizard.js  # create-new-bot platform steps only
```

> The committed shots show the other accounts/rows already present in the
> shared dev database at capture time. If that data is sensitive, re-take the
> admin captures against a fresh database before publishing.
