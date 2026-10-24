#!/usr/bin/env node
/**
 * Resilience walkthrough.
 *
 * Drives the real dashboard through the failure modes the product must
 * survive, and asserts the UI keeps its data instead of erroring out:
 *
 *   1. Auth form draft survives a reload; password never does.
 *   2. Backend killed while open → cached data + banner, no error page.
 *   3. Backend down on reload → persisted cache paints the last known state.
 *   4. Recovery → banner clears by itself (manual retry path included).
 *   5. Confirmed 401 → in-place re-auth modal over the preserved page.
 *
 * Usage: node scripts/resilience-check.mjs
 * Requires the Vite dev server on :5000.
 */
import puppeteer from 'puppeteer-core'

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:5000'
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell`

const RESULTS = []
const record = (name, pass, detail = '') => {
  RESULTS.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString()

const SESSION = {
  session: {
    id: 'session-1',
    userId: 'user-1',
    token: 'fixture-token',
    expiresAt: iso(86_400_000),
    createdAt: iso(-86_400_000),
    updatedAt: iso(),
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

const BOTS = [
  { sessionId: 'sess-alpha', platformId: 1, platform: 'discord', nickname: 'Persian', prefix: '!' },
  { sessionId: 'sess-beta', platformId: 2, platform: 'telegram', nickname: 'Nahida', prefix: '.' },
]

const BOT_DETAIL = {
  sessionId: 'sess-alpha',
  userId: 'user-1',
  platformId: 1,
  platform: 'discord',
  nickname: 'Persian',
  prefix: '!',
  admins: ['1'],
  premiums: [],
  credentials: { platform: 'discord', discordToken: 'x' },
}

function installRoutes(page, state) {
  return page.setRequestInterception(true).then(() => {
    page.on('request', (req) => {
      const url = req.url()
      if (!url.includes('/api/') && !url.includes('/socket.io')) {
        void req.continue()
        return
      }
      if (url.includes('/socket.io')) {
        void req.abort()
        return
      }
      if (state.mode === 'down') {
        void req.abort('failed')
        return
      }
      if (url.includes('/api/auth/get-session') || url.includes('/api/auth/admin/get-session')) {
        const body = state.session === 'null' ? null : SESSION
        void req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
        return
      }
      if (state.mode === 'expired') {
        void req.respond({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Session expired' }),
        })
        return
      }
      let body = {}
      if (url.endsWith('/api/v1/bots')) body = { bots: BOTS }
      else if (/\/api\/v1\/bots\/[^/]+\/commands/.test(url))
        body = { commands: [], total: 0, page: 1, limit: 12, totalPages: 0 }
      else if (/\/api\/v1\/bots\/[^/]+\/events/.test(url))
        body = { events: [], total: 0, page: 1, limit: 12, totalPages: 0 }
      else if (/\/api\/v1\/bots\/[^/]+\/logs/.test(url)) body = { entries: [] }
      else if (/\/api\/v1\/bots\/[^/]+\/admin-only/.test(url)) body = { enabled: false }
      else if (/\/api\/v1\/bots\/[^/]+\/reaction-emoji/.test(url)) body = { emoji: '👍' }
      else if (/\/api\/v1\/bots\/[^/]+$/.test(url)) body = BOT_DETAIL
      void req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
  })
}

const text = (page) => page.evaluate(() => document.body.innerText)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(page, predicate, timeout = 10_000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await predicate()) return true
    await wait(200)
  }
  return false
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. Auth form draft persistence
// ─────────────────────────────────────────────────────────────────────────────
{
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 390, height: 844 })
  const state = { mode: 'ok', session: 'null' }
  await installRoutes(page, state)

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
  await page.type('input[type="email"]', 'draft@example.com')
  await page.type('input[type="password"]', 'not-persisted')
  await wait(700)
  await page.reload({ waitUntil: 'networkidle2' })
  await wait(400)

  const emailValue = await page.$eval('input[type="email"]', (el) => el.value)
  const passwordValue = await page.$eval('input[type="password"]', (el) => el.value)
  const stored = await page.evaluate(() =>
    JSON.stringify({ ...sessionStorage, ...localStorage }),
  )
  record(
    'login draft survives reload',
    emailValue === 'draft@example.com',
    `email="${emailValue}"`,
  )
  record('password never restored', passwordValue === '', `password="${passwordValue}"`)
  record('password absent from storage', !stored.includes('not-persisted'))
  await context.close()
}

// ─────────────────────────────────────────────────────────────────────────────
// 2–4. Backend outage while open, offline reload, recovery
// ─────────────────────────────────────────────────────────────────────────────
{
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const state = { mode: 'ok', session: 'authed' }
  await installRoutes(page, state)

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2' })
  await waitFor(page, async () => (await text(page)).includes('Persian'))
  await wait(800) // let the persisted cache flush

  // Kill the backend while the page is open.
  state.mode = 'down'
  await page.setOfflineMode(true)
  // Headless Chrome's network emulation does not flip navigator.onLine, so
  // dispatch the same event the browser emits when the OS loses its network.
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await wait(1200)
  let body = await text(page)
  record('outage keeps rendered data', body.includes('Persian'))
  record('outage shows a status banner', /OFFLINE|SERVER UNAVAILABLE|RECONNECTING/.test(body))
  record('no crash page on outage', !/Internal Server Error|Something went wrong|Unhandled/i.test(body))

  // Recover.
  state.mode = 'ok'
  await page.setOfflineMode(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await wait(2500)
  body = await text(page)
  record('recovers automatically', !/SERVER UNAVAILABLE/.test(body) && body.includes('Persian'))

  // Reload with the backend down: persisted cache must paint the dashboard.
  state.mode = 'down'
  await page.reload({ waitUntil: 'domcontentloaded' })
  await wait(2500)
  body = await text(page)
  if (!body.includes('Persian')) {
    const cacheSize = await page.evaluate(
      () => localStorage.getItem('catbot:query-cache:v1')?.length ?? 0,
    )
    const cacheRaw = await page.evaluate(
      () => localStorage.getItem('catbot:query-cache:v1')?.slice(0, 600) ?? '',
    )
    console.log('DEBUG cacheSize', cacheSize, 'raw', cacheRaw)
    console.log('DEBUG body', body.slice(0, 400).replace(/\n+/g, ' | '))
  }
  record('down on fresh load shows cached data', body.includes('Persian'))
  record(
    'down on fresh load explains the outage',
    /SERVER UNAVAILABLE|RECONNECTING|OFFLINE/.test(body),
  )
  record('down on fresh load has no error page', !/Internal Server Error/i.test(body))

  // Manual recovery.
  state.mode = 'ok'
  const retryButton = await page.$('button')
  const clicked = await page.evaluate(() => {
    // The banner's recovery control; its label is "Retry now" or "Trying"
    // while an automatic attempt is in flight.
    const button = document.querySelector('[role="status"] button')
    button?.click()
    return Boolean(button)
  })
  const recovered = await waitFor(
    page,
    async () => {
      const current = await text(page)
      return !/SERVER UNAVAILABLE|RECONNECTING/.test(current) && current.includes('Persian')
    },
    12_000,
  )
  body = await text(page)
  if (!recovered) console.log('DEBUG retry body', body.slice(0, 500).replace(/\n+/g, ' | '))
  record('manual retry recovers', clicked && recovered)

  // ── 5. Confirmed session expiry → in-place re-auth ────────────────────────
  const beforeUrl = page.url()
  state.session = 'null'
  state.mode = 'expired'
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('catbot:auth-required'))
  })
  const modal = await waitFor(page, async () =>
    (await text(page)).includes('Sign in to resume'),
  )
  body = await text(page)
  record('expiry opens an in-place re-auth modal', modal)
  record('expiry keeps the dashboard data', body.includes('Persian'))
  record('expiry does not navigate away', page.url() === beforeUrl, page.url())

  void retryButton
  await context.close()
}

await browser.close()

const failed = RESULTS.filter((result) => !result.pass)
console.log(`\n${RESULTS.length - failed.length}/${RESULTS.length} checks passed`)
if (failed.length > 0) process.exitCode = 1
