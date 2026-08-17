/**
 * AI Agent — admin_remove_api tool
 *
 * SYSTEM ADMIN ONLY. Removes a registered free-API provider from the APIs
 * registry in packages/cat-bot/src/engine/lib/apis.lib.ts — the only file
 * this tool can edit. Commands that reference the removed provider via
 * createUrl('<name>', ...) will fall back to treating the name as an absolute
 * URL and throw, so only remove providers that are no longer used.
 */

import type { ToolMeta, ToolContext } from '../agent-tool.types.js';
import {
  requireSystemAdmin,
  readRepoFile,
  writeRepoFile,
  validateApiName,
  removeApiRegistryEntry,
  saveChangesHint,
  APIS_REPO_FILE,
} from '../lib/admin-source-tools.lib.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'admin_remove_api',
  description:
    'SYSTEM ADMIN ONLY — remove a registered free-API provider from the ' +
    `APIs registry (${APIS_REPO_FILE}) by its registry ` +
    "`name` (e.g. 'popcat'). Commands still calling createUrl('<name>', ...) " +
    'will error until they are updated, so remove only unused providers.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          "The registry key to remove, e.g. 'popcat' (lowercase letters, digits and underscores only).",
      },
    },
    required: ['name'],
  },
  adminOnly: true,
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  { name }: { name?: string },
  ctx: ToolContext,
): Promise<string> => {
  const denial = await requireSystemAdmin(ctx);
  if (denial) return denial;
  try {
    const apiName = validateApiName(String(name ?? ''));
    const content = await readRepoFile(APIS_REPO_FILE);
    const updated = removeApiRegistryEntry(content, apiName);
    await writeRepoFile(APIS_REPO_FILE, updated, false);
    return (
      `Removed API "${apiName}" from ${APIS_REPO_FILE}. ${saveChangesHint()}`
    );
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};
