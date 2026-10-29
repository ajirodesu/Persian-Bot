#!/usr/bin/env node
/**
 * Admin editor failure-mode checks.
 *
 * Exercises the real built page with a mocked admin/files API:
 *   1. a double Ctrl+S issues exactly one write;
 *   2. a save that resolves after switching files cannot overwrite the new file;
 *   3. a read failure shows an in-place retry and recovers;
 *   4. explicit Reload reads fresh disk content.
 *
 * Usage: npm run build -w packages/web && node scripts/editor-resilience.mjs
 */
import puppeteer from 'puppeteer-core'

const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:4173'
const chrome =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell`
const now = Date.now()
const iso = (o = 0) => new Date(now + o).toISOString()
const SESSION = {
  session: { id: 's', userId: 'u', token: 't', expiresAt: iso(86_400_000), createdAt: iso(-86_400_000), updatedAt: iso() },
  user: { id: 'u', name: 'Admin', email: 'admin@example.com', emailVerified: true, image: null, role: 'admin', createdAt: iso(-86_400_000), updatedAt: iso() },
}

const shaFor = (value) => {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return `sha-${hash}`
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

async function pageFor(state) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const url = req.url()
    if (!url.includes('/api/') && !url.includes('/socket.io')) return void req.continue()
    if (url.includes('/socket.io')) return void req.abort()
    if (url.includes('/api/admin-auth/get-session')) {
      return void req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) })
    }
    if (url.includes('/api/auth/get-session')) {
      return void req.respond({ status: 200, contentType: 'application/json', body: 'null' })
    }
    if (url.includes('/api/v1/settings/timezone')) {
      return void req.respond({ status: 200, contentType: 'application/json', body: '{"timezone":"UTC"}' })
    }
    if (url.includes('/api/v1/admin/files/meta')) {
      return void req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ owner: 'o', repo: 'r', branch: 'main', configured: true, root: '/repo' }) })
    }
    if (url.includes('/api/v1/admin/files/content')) {
      const path = new URL(url).searchParams.get('path') ?? ''
      if (state.failPath === path && state.failOnce) {
        state.failOnce = false
        return void req.respond({ status: 500, contentType: 'application/json', body: '{"error":"read boom"}' })
      }
      const content = state.files[path] ?? ''
      return void req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ path, content, language: 'plaintext', size: content.length, sha: shaFor(content) }) })
    }
    if (url.includes('/api/v1/admin/files/git/status')) {
      return void req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ branch: 'main', upstream: null, ahead: 0, behind: 0, changes: [] }) })
    }
    if (url.includes('/api/v1/admin/files') && req.method() === 'GET') {
      return void req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: '', entries: [] }) })
    }
    if (url.includes('/api/v1/admin/files') && req.method() === 'PUT') {
      const body = JSON.parse(req.postData() ?? '{}')
      const current = state.files[body.path] ?? ''
      if (body.expectedSha && body.expectedSha !== shaFor(current)) {
        return void req.respond({ status: 409, contentType: 'application/json', body: '{"error":"File changed on disk since it was opened. Reload it before saving."}' })
      }
      state.saveCount += 1
      const finish = () => {
        state.files[body.path] = body.content
        req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ synced: false, sha: shaFor(body.content) }) })
      }
      if (state.saveDelayMs > 0) setTimeout(finish, state.saveDelayMs)
      else finish()
      return
    }
    return void req.respond({ status: 200, contentType: 'application/json', body: '{}' })
  })
  return { context, page, pageErrors }
}

async function openEditor(page, path) {
  await page.goto(`${base}/admin/dashboard/files/edit?path=${encodeURIComponent(path)}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('textarea[aria-label$="code editor"]', { timeout: 20_000 })
  await page.waitForFunction(() => {
    const ta = document.querySelector('textarea[aria-label$="code editor"]')
    return ta && ta.value.length > 0
  }, { timeout: 15_000 })
}

async function typeAtEnd(page, text) {
  await page.click('textarea[aria-label$="code editor"]')
  await page.evaluate(() => {
    const ta = document.querySelector('textarea[aria-label$="code editor"]')
    if (ta) ta.setSelectionRange(ta.value.length, ta.value.length)
  })
  await page.keyboard.type(text, { delay: 0 })
  await new Promise((r) => setTimeout(r, 120))
}

async function saveShortcut(page) {
  await page.keyboard.down('Control')
  await page.keyboard.press('s')
  await page.keyboard.up('Control')
}

// 1. Double Ctrl+S → one write.
{
  const state = { files: { 'a.ts': 'const a = 1\n' }, saveCount: 0, saveDelayMs: 350, failPath: '', failOnce: false }
  const { context, page, pageErrors } = await pageFor(state)
  await openEditor(page, 'a.ts')
  await typeAtEnd(page, ' // edit')
  await saveShortcut(page)
  await saveShortcut(page)
  await new Promise((r) => setTimeout(r, 900))
  check('double save issues one write', state.saveCount === 1, `writes=${state.saveCount}`)
  check('double save persisted content', (state.files['a.ts'] ?? '').includes('// edit'))
  check('double save has no page errors', pageErrors.length === 0, pageErrors.join(' | '))
  await context.close()
}

// 2. Save resolves after switching files → new editor is not overwritten.
{
  const state = { files: { 'a.ts': 'FILE_A', 'b.ts': 'FILE_B' }, saveCount: 0, saveDelayMs: 700, failPath: '', failOnce: false }
  const { context, page, pageErrors } = await pageFor(state)
  await openEditor(page, 'a.ts')
  await typeAtEnd(page, ' EDITED_A')
  await saveShortcut(page)
  // Same-document route change to b.ts while the save is in flight.
  await page.evaluate(() => {
    window.history.pushState({}, '', '/admin/dashboard/files/edit?path=b.ts')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.waitForFunction(() => {
    const ta = document.querySelector('textarea[aria-label$="code editor"]')
    return ta && ta.value === 'FILE_B'
  }, { timeout: 10_000 })
  await new Promise((r) => setTimeout(r, 1100))
  const value = await page.$eval('textarea[aria-label$="code editor"]', (el) => el.value)
  check('path switch keeps new file content', value === 'FILE_B', value)
  check('old save persisted to its own path', (state.files['a.ts'] ?? '').includes('EDITED_A'))
  check('path switch has no page errors', pageErrors.length === 0, pageErrors.join(' | '))
  await context.close()
}

// 3. Read failure → in-place retry recovers.
{
  const state = { files: { 'boom.ts': 'RECOVERED_CONTENT' }, saveCount: 0, saveDelayMs: 0, failPath: 'boom.ts', failOnce: true }
  const { context, page, pageErrors } = await pageFor(state)
  await page.goto(`${base}/admin/dashboard/files/edit?path=boom.ts`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => /could not open file/i.test(document.body.innerText), { timeout: 15_000 })
  check('read failure shows in-place error', true)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Retry')
    button?.click()
  })
  await page.waitForFunction(() => {
    const ta = document.querySelector('textarea[aria-label$="code editor"]')
    return ta && ta.value === 'RECOVERED_CONTENT'
  }, { timeout: 10_000 })
  check('retry recovers the file', true)
  check('read failure has no page errors', pageErrors.length === 0, pageErrors.join(' | '))
  await context.close()
}

// 4. Explicit reload reads fresh disk content.
{
  const state = { files: { 'r.ts': 'ORIGINAL' }, saveCount: 0, saveDelayMs: 0, failPath: '', failOnce: false }
  const { context, page, pageErrors } = await pageFor(state)
  await openEditor(page, 'r.ts')
  state.files['r.ts'] = 'CHANGED_ON_DISK'
  await page.click('button[aria-label="Reload file from disk"]')
  await page.waitForFunction(() => {
    const ta = document.querySelector('textarea[aria-label$="code editor"]')
    return ta && ta.value === 'CHANGED_ON_DISK'
  }, { timeout: 10_000 })
  check('reload reads fresh content', true)
  check('reload has no page errors', pageErrors.length === 0, pageErrors.join(' | '))
  await context.close()
}

// 5. External edit → 409 conflict dialog; explicit Overwrite wins.
{
  const state = { files: { 'c.ts': 'BASE_CONTENT' }, saveCount: 0, saveDelayMs: 0, failPath: '', failOnce: false }
  const { context, page, pageErrors } = await pageFor(state)
  await openEditor(page, 'c.ts')
  // Change the file behind the editor's back; its cached sha is now stale.
  state.files['c.ts'] = 'EXTERNAL_CHANGE'
  await typeAtEnd(page, ' MY_EDIT')
  await saveShortcut(page)
  await page.waitForFunction(() => document.body.innerText.includes('File changed on disk'), { timeout: 10_000 })
  check('external change opens conflict dialog', true)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Overwrite')
    button?.click()
  })
  await new Promise((r) => setTimeout(r, 600))
  check('explicit overwrite saves local edits', (state.files['c.ts'] ?? '').includes('MY_EDIT'))
  check('conflict flow has no page errors', pageErrors.length === 0, pageErrors.join(' | '))
  await context.close()
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exitCode = 1
