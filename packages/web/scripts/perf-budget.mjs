/**
 * Author: AjiroDesu
 *
 * Performance budgets — fails (exit 1) when dist/ exceeds a budget.
 *
 * Usage: npm run perf:budget (after npm run build)
 *
 * Budgets are raw bytes on disk; browsers transfer gzip/brotli, so these
 * are conservative ceilings, not transfer predictions. Bump a budget only
 * with a measured justification, never to silence a regression.
 *
 * Current rationale (mobile Slow 4G, measured Sep 2026):
 * - entry JS 120kB: the index chunk blocks first paint; vendors split out.
 * - total JS 1.2MB: hard ceiling against dependency creep.
 * - CSS 220kB: Tailwind output; grows only with new utilities.
 * - fonts 120kB: self-hosted variable woff2 (Inter + JetBrains Mono latin).
 */
import { readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '../dist')
const BUDGETS = [
  { label: 'entry JS (index-*.js)', pattern: /^index-.*\.js$/, maxBytes: 120 * 1024 },
  { label: 'total JS', pattern: /\.js$/, maxBytes: 1200 * 1024 },
  { label: 'total CSS', pattern: /\.css$/, maxBytes: 220 * 1024 },
  { label: 'self-hosted fonts', pattern: /\.woff2$/, maxBytes: 120 * 1024 },
]

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

let failed = false
for (const { label, pattern, maxBytes } of BUDGETS) {
  let total = 0
  for (const file of walk(DIST)) {
    if (pattern.test(file.split('/').pop())) total += statSync(file).size
  }
  const kb = (total / 1024).toFixed(1)
  const maxKb = (maxBytes / 1024).toFixed(0)
  if (total > maxBytes) {
    console.error(`BUDGET FAIL  ${label}: ${kb} kB > ${maxKb} kB`)
    failed = true
  } else {
    console.log(`budget ok    ${label}: ${kb} kB / ${maxKb} kB`)
  }
}
if (failed) {
  console.error('\nPerformance budget exceeded — investigate before shipping.')
  process.exit(1)
}
console.log('\nAll performance budgets pass.')
