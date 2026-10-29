#!/usr/bin/env node
/**
 * Admin code-editor benchmark.
 *
 * Drives the real /admin/dashboard/files/edit page with a mocked admin
 * session and mocked file reads, then measures cold open time, typing
 * responsiveness, DOM size, JS heap and long tasks for 100 / 1000 / 5000 line
 * files. No repository files are touched.
 *
 * Usage: node scripts/editor-bench.mjs [--out=path]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = path.dirname(fileURLToPath(import.meta.url))
const base = process.env.AUDIT_BASE ?? 'http://127.0.0.1:5000'
const chrome =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell`
const outArg = process.argv.find((a) => a.startsWith('--out='))
const outFile = outArg
  ? outArg.split('=')[1]
  : path.resolve(here, '../../../docs/perf-review/editor-baseline.json')

const now = Date.now()
const iso = (offset = 0) => new Date(now + offset).toISOString()
const SESSION = {
  session: { id: 's', userId: 'u', token: 't', expiresAt: iso(86_400_000), createdAt: iso(-86_400_000), updatedAt: iso() },
  user: { id: 'u', name: 'Ajiro Desu', email: 'admin@example.com', emailVerified: true, image: null, role: 'admin', createdAt: iso(-86_400_000), updatedAt: iso() },
}

function sample(lines, language = 'typescript') {
  const out = []
  for (let i = 0; i < lines; i += 1) {
    if (i % 10 === 0) out.push(`// section ${i} — generated benchmark content`)
    out.push(`export function workload${i}(input: number): number {`)
    out.push(`  const scaled = input * ${i + 1}`)
    out.push(`  return scaled + ${i}`)
    out.push('}')
    out.push('')
  }
  return { content: out.join('\n'), language }
}

// Each block is five source lines; keep block counts so the fixture body is
// deterministic, but label the real resulting line count in the report.
const CASES = [
  ['small-500-lines', 100],
  ['medium-5000-lines', 1000],
  ['large-25000-lines', 5000],
]

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
})

const results = []

for (const [name, lines] of CASES) {
  const file = sample(lines)
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('socket.io')) errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))

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
    if (url.includes('/api/v1/admin/files/content')) {
      return void req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ path: 'bench.ts', content: file.content, language: file.language, size: file.content.length, sha: 'sha' }),
      })
    }
    if (url.includes('/api/v1/settings/timezone')) {
      return void req.respond({ status: 200, contentType: 'application/json', body: '{"timezone":"UTC"}' })
    }
    return void req.respond({ status: 200, contentType: 'application/json', body: '{}' })
  })

  const t0 = Date.now()
  await page.goto(`${base}/admin/dashboard/files/edit?path=bench.ts`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('textarea[aria-label$="code editor"]', { timeout: 45_000 })
  await page.waitForFunction(() => {
    const ta = document.querySelector('textarea[aria-label$="code editor"]')
    return ta && ta.value.length > 100
  }, { timeout: 20_000 })
  const openMs = Date.now() - t0

  // Install long-task observation before typing.
  await page.evaluate(() => {
    window.__longTasks = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longTasks.push(entry.duration)
    }).observe({ type: 'longtask', buffered: true })
  })

  const textarea = await page.$('textarea[aria-label$="code editor"]')
  await textarea.click()
  await page.evaluate(() => {
    const ta = document.querySelector('textarea[aria-label$="code editor"]')
    if (ta) {
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    }
  })

  const typeStart = Date.now()
  const typed = 'const benchmarkTyping = 12345'
  await page.keyboard.type(typed, { delay: 0 })
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const typeMs = Date.now() - typeStart

  const stats = await page.evaluate(() => {
    const ta = document.querySelector('textarea[aria-label$="code editor"]')
    const editor = document.querySelector('.code-editor')
    return {
      nodes: document.querySelectorAll('*').length,
      editorNodes: editor ? editor.querySelectorAll('*').length : 0,
      textareaChars: ta ? ta.value.length : 0,
      savedText: ta ? ta.value.slice(-40) : '',
      longTasks: window.__longTasks ?? [],
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) : null,
    }
  })

  if (process.argv.includes('--shot')) {
    await page.screenshot({ path: path.resolve(here, `../../../docs/perf-review/editor-${name}.png`) })
  }

  const longTaskTotal = stats.longTasks.reduce((a, b) => a + b, 0)
  results.push({
    case: name,
    lines,
    openMs,
    typeMs,
    msPerChar: Number((typeMs / typed.length).toFixed(2)),
    domNodes: stats.nodes,
    editorNodes: stats.editorNodes,
    longTasks: stats.longTasks.length,
    longTaskMs: Number(longTaskTotal.toFixed(1)),
    heapMB: stats.heapMB,
    typedOk: stats.savedText.endsWith('12345'),
    consoleErrors: errors,
  })
  await context.close()
}

await browser.close()
await mkdir(path.dirname(outFile), { recursive: true })
await writeFile(outFile, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
