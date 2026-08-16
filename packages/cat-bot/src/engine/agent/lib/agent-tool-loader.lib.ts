/**
 * AI Agent — Dynamic Tool Loader
 *
 * Scans the agent-tools/ directory at runtime and imports every module that
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
import type { AgentTool } from './agent-tool.types.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// The loader lives one level above the tools, so resolve the sibling
// directory rather than scanning the ai-agent/ folder itself.
const TOOLS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'agent-tools',
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

  const tools: AgentTool[] = [];
  const files = (await fs.promises.readdir(TOOLS_DIR)).filter(
    (f) =>
      (f.endsWith('.js') || f.endsWith('.ts')) &&
      !f.endsWith('.d.ts') &&
      !NON_TOOLS.has(f),
  );

  for (const file of files) {
    try {
      const mod = (await import(
        pathToFileURL(path.join(TOOLS_DIR, file)).href
      )) as Partial<AgentTool>;
      // Ensure the module implements the AgentTool interface properly.
      if (mod.meta && typeof mod.initialize === 'function') {
        tools.push(mod as AgentTool);
      } else {
        logger.warn('[AgentTool] Skipping non-tool module', { file });
      }
    } catch (err) {
      logger.error('[AgentTool] Failed to load tool', { file, err });
    }
  }

  cachedTools = tools;
  return cachedTools;
}
