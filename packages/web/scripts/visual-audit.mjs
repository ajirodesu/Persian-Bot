#!/usr/bin/env node
/**
 * Visual audit harness.
 *
 * Renders every route at 375 / 768 / 1440 with a fixture-backed API so the
 * dashboard can be reviewed without a live account or database. Writes PNGs
 * plus a JSON report of console errors and failed requests to
 * docs/design-review/.
 *
 * Usage: node scripts/visual-audit.mjs [--only=home,login,...] [--base=...]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../../../docs/design-review')
const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:5000'
const executablePath =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell`

const now = Date.now()
const iso = (offsetMs = 0) => new Date(now + offsetMs).toISOString()

const BOTS = [
  { sessionId: 'sess-alpha', platformId: 1, platform: 'discord', nickname: 'Persian', prefix: '!' },
  { sessionId: 'sess-beta', platformId: 2, platform: 'telegram', nickname: 'Nahida', prefix: '.' },
  { sessionId: 'sess-gamma', platformId: 2, platform: 'telegram', nickname: 'Archive', prefix: '-' },
]

const BOT_DETAIL = {
  sessionId: 'sess-alpha',
  userId: 'user-1',
  platformId: 1,
  platform: 'discord',
  nickname: 'Persian',
  prefix: '!',
  admins: ['1029384756', '5647382910'],
  premiums: ['antispam', 'automod'],
  credentials: { platform: 'discord', discordToken: 'MTIzNDU2Nzg5.secret.token' },
}

const COMMANDS = [
  ['afk', 'Mark yourself as AFK with an optional reason.', true, 1],
  ['antispam', 'Toggle the heuristic spam filter for this session.', true, 0],
  ['badwords', 'Manage the blocked-word list.', false, 0],
  ['kick', 'Remove a member from the server.', true, 0],
  ['play', 'Search and stream audio in a voice channel.', false, 0],
  ['prefix', 'Change the command prefix.', true, 0],
  ['warn', 'Issue a warning to a member.', true, 0],
].map(([commandName, description, isEnable, ignoresAdminOnly], i) => ({
  commandName,
  description,
  isEnable,
  ignoresAdminOnly,
  version: '1.0.0',
  role: i === 3 ? 100 : 0,
  aliases: [],
  cooldown: 3,
  author: 'AjiroDesu',
}))

const EVENTS = ['welcome', 'goodbye', 'log', 'notice', 'checkwarn'].map((eventName, i) => ({
  eventName,
  description: `Event handler: ${eventName}`,
  isEnable: i < 3,
  version: '1.0.0',
  author: 'AjiroDesu',
}))

const USERS = Array.from({ length: 8 }, (_, i) => ({
  id: `10000000000000000${i}`,
  name: i === 0 ? 'Ajiro Desu' : `Member ${String(i).padStart(2, '0')}`,
  first_name: i === 0 ? 'Ajiro' : `Member`,
  username: i === 0 ? 'ajirodesu' : `member_${i}`,
  avatar_url: null,
  last_seen: iso(-i * 3_600_000),
  is_banned: i === 3,
  ban_reason: i === 3 ? 'Spam' : null,
}))

const GROUPS = Array.from({ length: 6 }, (_, i) => ({
  id: `20000000000000000${i}`,
  name: i === 0 ? 'Persian HQ' : `Channel ${i}`,
  is_group: true,
  type: i % 2 === 0 ? 'supergroup' : 'channel',
  member_count: 1200 - i * 130,
  avatar_url: null,
  last_seen: iso(-i * 7_200_000),
  is_banned: false,
  ban_reason: null,
}))

let authMode = 'none'

const ADMIN_SESSION = {
  session: { id: 'admin-session', userId: 'admin-1', token: 'admin-token', expiresAt: iso(86_400_000), createdAt: iso(-86_400_000), updatedAt: iso() },
  user: { id: 'admin-1', name: 'Ajiro Desu', email: 'admin@example.com', emailVerified: true, image: null, role: 'admin', createdAt: iso(-86_400_000), updatedAt: iso() },
}

const fixture = (url) => {
  const path = new URL(url).pathname
  if (path.endsWith('/api/admin-auth/get-session')) {
    return authMode === 'admin' ? ADMIN_SESSION : null
  }
  if (path.endsWith('/api/auth/get-session')) {
    if (authMode !== 'user') return null
    return {
      session: {
        id: 'session-1',
        userId: 'user-1',
        token: 'fixture-token',
        expiresAt: iso(86_400_000),
        createdAt: iso(-86_400_000),
        updatedAt: iso(),
        ipAddress: '127.0.0.1',
        userAgent: 'visual-audit',
      },
      user: {
        id: 'user-1',
        name: 'Ajiro Desu',
        email: 'ajiro@example.com',
        emailVerified: true,
        image: null,
        role: 'user',
        createdAt: iso(-86_400_000),
        updatedAt: iso(),
      },
    }
  }
  if (path.endsWith('/api/v1/validate/email-status')) return { exists: true, verified: true }
  if (path.endsWith('/api/v1/bots')) return { bots: BOTS }
  if (/\/api\/v1\/bots\/[^/]+\/commands/.test(path)) {
    return { commands: COMMANDS, total: 42, page: 1, limit: 12, totalPages: 4 }
  }
  if (/\/api\/v1\/bots\/[^/]+\/events/.test(path)) {
    return { events: EVENTS, total: 18, page: 1, limit: 12, totalPages: 2 }
  }
  if (/\/api\/v1\/bots\/[^/]+\/logs/.test(path)) {
    return {
      entries: [
        '\u001b[32m[12:04:01] INFO\u001b[0m session loaded — discord.js v14.27.0',
        '\u001b[36m[12:04:02] INFO\u001b[0m gateway handshake complete (shard 0/1)',
        '[12:04:03] INFO prefix resolved: "!"',
        '\u001b[33m[12:04:09] WARN\u001b[0m rate limit bucket 1/3 — waiting 420ms',
        '[12:04:11] INFO commands registered: 42',
        '\u001b[32m[12:04:12] INFO\u001b[0m ready as Persian#0912',
        '[12:05:44] INFO /help used by ajirodesu in #support',
        '\u001b[31m[12:06:12] ERROR\u001b[0m REQUEST_FAILED: guild member fetch returned 404',
        '[12:06:12] INFO retrying member fetch (attempt 1/3)',
        '\u001b[32m[12:06:13] INFO\u001b[0m member fetch recovered',
      ],
    }
  }
  if (/\/api\/v1\/bots\/[^/]+\/admin-only/.test(path)) return { enabled: false }
  if (/\/api\/v1\/bots\/[^/]+\/reaction-emoji/.test(path)) return { emoji: '👍' }
  if (/\/api\/v1\/bots\/[^/]+\/database\/users/.test(path)) {
    return { users: USERS, total: 128, page: 1, limit: 20, totalPages: 7 }
  }
  if (/\/api\/v1\/bots\/[^/]+\/database\/groups/.test(path)) {
    return { groups: GROUPS, total: 31, page: 1, limit: 20, totalPages: 2 }
  }
  if (/\/api\/v1\/bots\/[^/]+\/database\/servers/.test(path)) {
    return { servers: GROUPS.map((g) => ({ ...g, is_group: false, type: 'guild' })), total: 6 }
  }
  if (/\/api\/v1\/bots\/[^/]+\/database\/channels/.test(path)) {
    return {
      channels: Array.from({ length: 5 }, (_, i) => ({
        id: `30000000000000000${i}`,
        name: `channel-${i}`,
        type: 'text',
        server_id: '200000000000000000',
        is_banned: false,
        ban_reason: null,
      })),
      total: 5,
      page: 1,
      limit: 20,
      totalPages: 1,
    }
  }
  if (/\/api\/v1\/bots\/[^/]+$/.test(path)) return BOT_DETAIL
  if (path.includes('/api/v1/admin/bots')) {
    return {
      bots: BOTS.map((b, i) => ({ ...b, userId: 'user-1', isRunning: i < 2, userName: 'Ajiro Desu', userEmail: 'ajiro@example.com' })),
      total: 3, page: 1, limit: 10, totalPages: 1,
      stats: { totalBots: 3, activeBots: 2, platformDist: { discord: 1, telegram: 2 }, platformActiveDist: { discord: 1, telegram: 1 } },
    }
  }
  if (path.includes('/api/v1/admin/users')) {
    return {
      users: USERS.slice(0, 6).map((u, i) => ({ id: u.id, name: u.name, email: `user${i}@example.com`, role: i === 0 ? 'admin' : 'user', createdAt: iso(-i * 86_400_000), banned: false, emailVerified: true })),
      total: 128, page: 1, limit: 10, totalPages: 13,
      stats: { totalUsers: 128, adminCount: 1, bannedCount: 4 },
    }
  }
  if (path.includes('/api/v1/admin/system-admins')) return { admins: [] }
  if (path.includes('/api/v1/admin/maintenance')) return { enabled: false }
  if (path.startsWith('/socket.io')) return null
  return {}
}

const PUBLIC_ROUTES = new Set(['home','login','signup','forgot-password','reset-password','verify','not-found','admin-login'])
const ADMIN_ROUTES = new Set(['admin-dashboard','admin-users','admin-bots'])

const ROUTES = [
  ['home', '/'],
  ['login', '/login'],
  ['signup', '/signup'],
  ['forgot-password', '/forgot-password'],
  ['reset-password', '/reset-password'],
  ['verify', '/account-verification'],
  ['dashboard', '/dashboard'],
  ['bot-console', '/dashboard/bot?id=sess-alpha'],
  ['bot-commands', '/dashboard/bot/commands?id=sess-alpha'],
  ['bot-events', '/dashboard/bot/events?id=sess-alpha'],
  ['bot-database', '/dashboard/bot/database?id=sess-alpha'],
  ['bot-settings', '/dashboard/bot/settings?id=sess-alpha'],
  ['chat-room', '/dashboard/chat-room'],
  ['dashboard-settings', '/dashboard/settings'],
  ['create-bot', '/dashboard/create-new-bot'],
  ['not-found', '/not-a-real-page'],
  ['admin-login', '/admin'],
  ['admin-dashboard', '/admin/dashboard'],
  ['admin-users', '/admin/dashboard/users'],
  ['admin-bots', '/admin/dashboard/bots'],
]

const VIEWPORTS = [
  ['mobile', 375, 812],
  ['tablet', 768, 1024],
  ['desktop', 1440, 900],
]

const onlyArg = process.argv.find((a) => a.startsWith('--only='))
const only = onlyArg ? new Set(onlyArg.split('=')[1].split(',')) : null

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
})

const report = []
await mkdir(outDir, { recursive: true })

for (const [name, route] of ROUTES) {
  if (only && !only.has(name)) continue
  authMode = ADMIN_ROUTES.has(name) ? 'admin' : PUBLIC_ROUTES.has(name) ? 'none' : 'user'
  for (const [vp, width, height] of VIEWPORTS) {
    const page = await browser.newPage()
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    const errors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('socket.io')) errors.push(`console: ${msg.text()}`)
    })
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
    page.on('requestfailed', (req) => {
      if (!req.url().includes('socket.io')) {
        errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText ?? ''}`)
      }
    })

    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const url = req.url()
      if (!url.startsWith(base) || !url.includes('/api/')) {
        if (url.includes('/socket.io/')) {
          void req.abort()
          return
        }
        void req.continue()
        return
      }
      const body = fixture(url)
      void req.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true' },
        body: JSON.stringify(body),
      })
    })

    try {
      await page.goto(`${base}${route}`, { waitUntil: 'networkidle2', timeout: 45_000 })
      await new Promise((r) => setTimeout(r, 900))
      await page.screenshot({ path: resolve(outDir, `${name}-${vp}.png`), fullPage: false })
      report.push({ name, vp, route, errors })
    } catch (err) {
      report.push({ name, vp, route, errors: [...errors, `fatal: ${err.message}`] })
    }
    await page.close()
  }
}

await browser.close()
await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(`wrote ${report.length} shots to ${outDir}`)
const failing = report.filter((r) => r.errors.length)
for (const f of failing) console.log(`${f.name}@${f.vp}: ${f.errors.join(' | ')}`)
