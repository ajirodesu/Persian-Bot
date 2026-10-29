#!/usr/bin/env node
/**
 * Dashboard navigation benchmark (production build, mocked API).
 *
 * Measures full route loads for the user dashboard and admin shell, an
 * in-app admin nav click, and the Files → Editor hand-off after hover
 * prefetch. Timings are wall-clock from navigation/click to the target
 * content being visible, including JS chunk resolution.
 */
import puppeteer from 'puppeteer-core'

const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:4173'
const chrome =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell`
const now = Date.now()
const iso = (o = 0) => new Date(now + o).toISOString()
const USER = {
  session: { id: 's', userId: 'u', token: 't', expiresAt: iso(86_400_000), createdAt: iso(-86_400_000), updatedAt: iso() },
  user: { id: 'u', name: 'Ajiro Desu', email: 'a@b.co', emailVerified: true, image: null, role: 'user', createdAt: iso(-86_400_000), updatedAt: iso() },
}
const ADMIN = { ...USER, user: { ...USER.user, role: 'admin' } }
const BOTS = [{ sessionId: 's1', platformId: 1, platform: 'discord', nickname: 'Persian', prefix: '!' }]
const FILES = [{ name: 'bench.ts', path: 'bench.ts', type: 'file', size: 20, sha: 's', lastCommit: null }]

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

function respond(req, body, status = 200) {
  req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function makePage() {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const url = req.url()
    if (!url.includes('/api/') && !url.includes('/socket.io')) return void req.continue()
    if (url.includes('/socket.io')) return void req.abort()
    if (url.includes('/api/admin-auth/get-session')) return respond(req, ADMIN)
    if (url.includes('/api/auth/get-session')) return respond(req, USER)
    if (url.includes('/api/v1/settings/timezone')) return respond(req, { timezone: 'UTC' })
    if (url.endsWith('/api/v1/bots')) return respond(req, { bots: BOTS })
    if (url.includes('/api/v1/admin/users')) return respond(req, { users: [], total: 0, page: 1, limit: 10, totalPages: 0, stats: { totalUsers: 0, adminCount: 0, bannedCount: 0 } })
    if (url.includes('/api/v1/admin/bots')) return respond(req, { bots: [], total: 0, page: 1, limit: 10, totalPages: 0, stats: { totalBots: 0, activeBots: 0, platformDist: {}, platformActiveDist: {} } })
    if (url.includes('/api/v1/admin/files/content')) return respond(req, { path: 'bench.ts', content: 'export const ok = true\n', language: 'typescript', size: 23, sha: 's' })
    if (url.includes('/api/v1/admin/files/meta')) return respond(req, { owner: 'o', repo: 'r', branch: 'main', configured: true, root: '/repo' })
    if (url.includes('/api/v1/admin/files/git/status')) return respond(req, { branch: 'main', upstream: null, ahead: 0, behind: 0, changes: [] })
    if (url.includes('/api/v1/admin/files') && req.method() === 'GET') return respond(req, { path: '', entries: FILES })
    return respond(req, {})
  })
  return { context, page }
}

async function timed(fn) {
  const t0 = performance.now()
  await fn()
  return Math.round(performance.now() - t0)
}

const results = []
{
  const { context, page } = await makePage()
  const ms = await timed(async () => {
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.body.innerText.includes('Persian'))
  })
  results.push({ case: 'user dashboard (cold route)', ms })
  await context.close()
}
{
  const { context, page } = await makePage()
  const ms = await timed(async () => {
    await page.goto(`${base}/admin/dashboard`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.body.innerText.includes('TOTALS'))
  })
  results.push({ case: 'admin overview (cold route)', ms })
  const usersMs = await timed(async () => {
    await page.click('a[href="/admin/dashboard/users"]')
    await page.waitForFunction(() => document.body.innerText.includes('USERS'))
  })
  results.push({ case: 'admin overview → users (click)', ms: usersMs })
  const filesMs = await timed(async () => {
    await page.click('a[href="/admin/dashboard/files"]')
    await page.waitForFunction(() => document.body.innerText.includes('bench.ts'))
  })
  results.push({ case: 'users → files (click)', ms: filesMs })

  // Hover the file row first (intent prefetch), then open. This is the normal
  // operator gesture, not a cold URL load.
  const row = await page.$('[title="bench.ts"]')
  if (row) {
    await row.hover()
    await new Promise((r) => setTimeout(r, 250))
  }
  const editorMs = await timed(async () => {
    if (row) await row.click()
    await page.waitForSelector('textarea[aria-label$="code editor"]')
    await page.waitForFunction(() => document.querySelector('textarea[aria-label$="code editor"]')?.value.includes('ok'))
  })
  results.push({ case: 'files → editor (hover prefetch)', ms: editorMs })
  await context.close()
}

await browser.close()
console.log(JSON.stringify(results, null, 2))
