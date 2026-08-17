/**
 * AI Agent — admin_list_apis tool
 *
 * SYSTEM ADMIN ONLY. Lists every registered free-API provider in the APIs
 * registry (packages/cat-bot/src/engine/lib/apis.lib.ts — the "api/lib"
 * registry file): name, base URL, and whether an API key is configured.
 */

import type { ToolMeta, ToolContext } from '../agent-tool.types.js';
import {
  requireSystemAdmin,
  readRepoFile,
  parseApisRegistry,
  APIS_REPO_FILE,
} from '../lib/admin-source-tools.lib.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'admin_list_apis',
  description:
    'SYSTEM ADMIN ONLY — list every registered free-API provider in the ' +
    `APIs registry (${APIS_REPO_FILE}). ` +
    'Shows each provider name, its base URL, and whether an API key is set. ' +
    'Use before adding or removing an API.',
  parameters: {
    type: 'object',
    properties: {},
  },
  adminOnly: true,
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> => {
  const denial = await requireSystemAdmin(ctx);
  if (denial) return denial;
  try {
    const content = await readRepoFile(APIS_REPO_FILE);
    const entries = parseApisRegistry(content);
    if (entries.length === 0) {
      return `The APIs registry (${APIS_REPO_FILE}) has no entries.`;
    }
    const lines = entries.map((e) => {
      const key = e.apiKey ? ' (API key set)' : '';
      return `• ${e.name} → ${e.baseURL}${key}`;
    });
    return `Registered free APIs (${entries.length}):\n${lines.join('\n')}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};
