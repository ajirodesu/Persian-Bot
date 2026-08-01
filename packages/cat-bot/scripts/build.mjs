/**
 * Production Build — esbuild bundler
 *
 * WHY THIS REPLACES `tsc && tsc-alias`:
 * The previous pipeline emitted a 1:1 compiled .js file for every .ts source file
 * (~450 files) and rewrote `@/` aliases to relative paths as a separate pass. At
 * boot, Node had to resolve and read every one of those files individually — each
 * resolution is a handful of synchronous fs.stat/fs.readFile calls — before the
 * process could start accepting messages. That's pure overhead on every cold start,
 * restart, and redeploy, layered on top of the DB/gateway connection work.
 *
 * esbuild bundles the entire statically-reachable engine/server graph (everything
 * reached by static `import` from app.ts) into a single dist/engine/app.js, so Node
 * performs one module resolution instead of hundreds. `@/` aliases are resolved and
 * inlined at build time via the project's tsconfig "paths", so tsc-alias is no
 * longer needed as a separate pass.
 *
 * WHY MULTIPLE ENTRY POINTS (not a single-file bundle):
 * Commands, events, and agent tools are loaded at RUNTIME via a directory scan +
 * dynamic `import()` of whatever files exist on disk (see engine/app.ts loadCommands()
 * and engine/agent/agent.ts loadTools()) — this is the whole point of that
 * architecture: dropping a new file into app/commands/ registers a new command with
 * zero wiring elsewhere. Because the import specifier is built from a runtime
 * directory listing, esbuild can't see or follow it statically, so those files can
 * never be inlined into the main bundle. Passing them in as their OWN entry points
 * (rather than leaving them as loose tsc output) means:
 *   - Each still lands at the same predictable dist/app/commands/<name>.js path the
 *     runtime loader already expects — zero changes needed to the loader itself.
 *   - `splitting: true` lets esbuild factor out engine code shared across dozens of
 *     command files (e.g. @/engine/repos/*, @/engine/lib/*) into a handful of shared
 *     chunk files instead of duplicating that code into every single command's
 *     output — smaller total dist size, single parse of shared code.
 *   - Each command/event/tool file is still bundled+minified individually, so a
 *     command that's rarely used costs nothing until its file is actually imported.
 */

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

/** Lists *.ts files (non-.d.ts) directly inside a directory, relative to `root`. */
function listTsFiles(relDir) {
  const abs = path.join(root, relDir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => path.join(relDir, f));
}

const entryPoints = [
  'src/engine/app.ts',
  ...listTsFiles('src/app/commands'),
  ...listTsFiles('src/app/events'),
  ...listTsFiles('src/engine/agent/tools'),
];

const start = performance.now();

await build({
  absWorkingDir: root,
  entryPoints,
  outdir: 'dist',
  outbase: 'src',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // Resolves the @/ and @cat-bot/ path aliases at build time using tsconfig's
  // "paths" map — this is what previously required the separate tsc-alias pass.
  tsconfig: 'tsconfig.json',
  // Every runtime dependency (discord.js, grammy, express, pg, mongodb, ...) stays
  // a real node_modules import rather than getting inlined. Bundling native/binary
  // or dynamically-requiring packages is a common source of subtle runtime breakage,
  // and it buys nothing here — the win is collapsing OUR ~450 files, not vendor code.
  packages: 'external',
  minify: true,
  sourcemap: true,
  // Legal comments (license headers) from bundled deps aren't relevant here since
  // deps are external — keeps output clean without a separate .LEGAL.txt per file.
  legalComments: 'none',
  logLevel: 'info',
});

const ms = (performance.now() - start).toFixed(0);
console.log(`\n✓ esbuild bundle complete in ${ms}ms — ${entryPoints.length} entry points`);
