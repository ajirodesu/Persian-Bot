/**
 * AI Agent — Dynamic Tool Loader
 *
 * Scans the tools/ directory at runtime and imports every module that
 * implements the unified `{ meta, initialize }` shape — the same modular
 * architecture upstream Cat-Bot uses for its agent tools. A new tool is a new
 * file in this directory; no registry edits required.
 *
 * Works symmetrically from src/ (tsx watch loads .ts files) and dist/ (the
 * compiled build loads .js files, skipping .d.ts). Results are cached for the
 * lifecycle of the process — tool files don't change at runtime.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { AgentTool } from '../agent-tool.types.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// Tools live in agent/tools/, a sibling of this loader's agent/lib/ directory —
// resolve one level up so the path is correct in both src/ and dist/.
const TOOLS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tools',
);

// Defensive guard for anything in the tools directory that isn't a tool
// (e.g. a README or a stray index file). The { meta, initialize } shape
// check below is the real filter.
const NON_TOOLS = new Set([
  'index.ts',
  'index.js',
  'README.md',
  'readme.md',
]);

let cachedTools: AgentTool[] | null = null;

/** Dynamically loads all tool modules in the directory (cached after first call). */
export async function loadAgentTools(): Promise<AgentTool[]> {
  if (cachedTools) return cachedTools;

  const files = (await fs.promises.readdir(TOOLS_DIR)).filter(
    (f) =>
      (f.endsWith('.js') || f.endsWith('.ts')) &&
      !f.endsWith('.d.ts') &&
      !NON_TOOLS.has(f),
  );

  // Fan the dynamic imports out in parallel (Promise.allSettled semantics:
  // one broken tool file never blocks the rest) — the sequential loop paid
  // each import's latency serially on the first agent turn / warm-up.
  const settled = await Promise.allSettled(
    files.map(async (file) => {
      const mod = (await import(
        pathToFileURL(path.join(TOOLS_DIR, file)).href
      )) as Partial<AgentTool>;
      return { file, mod };
    }),
  );
  const tools: AgentTool[] = [];
  for (const result of settled) {
    if (result.status === 'rejected') {
      logger.error('[AgentTool] Failed to load tool', {
        error: result.reason,
      });
      continue;
    }
    const { file, mod } = result.value;
    // Ensure the module implements the AgentTool interface properly.
    if (mod.meta && typeof mod.initialize === 'function') {
      tools.push(mod as AgentTool);
    } else {
      logger.warn('[AgentTool] Skipping non-tool module', { file });
    }
  }

  cachedTools = tools;
  return cachedTools;
}
