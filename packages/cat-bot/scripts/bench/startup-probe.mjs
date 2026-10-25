#!/usr/bin/env node
/**
 * Built-artifact startup probe.
 *
 * Measures command discovery + registration against `dist/`, which is what
 * production actually runs. The TypeScript-source benchmark reports a higher
 * number because tsx transpiles every module on import.
 *
 * Usage: npm run build -w packages/cat-bot && npm run bench:startup -w packages/cat-bot
 */
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const distLoader = path.resolve(here, '../../dist/engine/modules/command/command-loader.lib.js');
const commandsDir = path.resolve(here, '../../dist/app/commands');

const loader = await import(pathToFileURL(distLoader).href);

const heapBefore = process.memoryUsage().heapUsed;
const coldStart = performance.now();
const first = await loader.loadCommandsWithDiagnostics(commandsDir);
const coldMs = performance.now() - coldStart;

const warmStart = performance.now();
const second = await loader.loadCommandsWithDiagnostics(commandsDir);
const warmMs = performance.now() - warmStart;
const heapAfter = process.memoryUsage().heapUsed;

console.log(
  JSON.stringify(
    {
      files: first.errors.length === 0 ? new Set([...first.commands.values()]).size : null,
      keys: first.commands.size,
      coldMs: Number(coldMs.toFixed(1)),
      warmMs: Number(warmMs.toFixed(1)),
      errors: first.errors,
      heapDeltaMb: Number(((heapAfter - heapBefore) / 1024 / 1024).toFixed(1)),
      secondKeys: second.commands.size,
    },
    null,
    2,
  ),
);
