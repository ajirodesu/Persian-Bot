/**
 * AI Agent — admin_add_api tool
 *
 * SYSTEM ADMIN ONLY. Adds a NEW free-API provider to the APIs registry in
 * packages/cat-bot/src/engine/lib/apis.lib.ts — the only file this tool can
 * edit. The entry is inserted into the `APIs` registry object so command
 * modules can start using it via createUrl() immediately (no restart needed
 * for a new command that references it; the registry is read at runtime).
 */

import type { ToolMeta, ToolContext } from '../agent-tool.types.js';
import {
  requireSystemAdmin,
  readRepoFile,
  writeRepoFile,
  validateApiName,
  validateApiBaseURL,
  addApiRegistryEntry,
  saveChangesHint,
  APIS_REPO_FILE,
} from '../lib/admin-source-tools.lib.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'admin_add_api',
  description:
    'SYSTEM ADMIN ONLY — add a NEW free-API provider to the APIs registry ' +
    `(${APIS_REPO_FILE}). ` +
    'Provide a lowercase registry `name` (letters/digits/underscores), a valid ' +
    "absolute http(s) `base_url`, and optionally an `api_key`. Command modules " +
    'can then use createUrl(\'<name>\', ...) immediately.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          "Registry key, e.g. 'myapi' (lowercase letters, digits and underscores only).",
      },
      base_url: {
        type: 'string',
        description:
          "The provider's base URL, e.g. 'https://api.example.com' (absolute http(s) URL).",
      },
      api_key: {
        type: 'string',
        description:
          'Optional API key stored in the registry and appended to requests by createUrl().',
      },
    },
    required: ['name', 'base_url'],
  },
  adminOnly: true,
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  { name, base_url, api_key }: { name?: string; base_url?: string; api_key?: string },
  ctx: ToolContext,
): Promise<string> => {
  const denial = await requireSystemAdmin(ctx);
  if (denial) return denial;
  try {
    const apiName = validateApiName(String(name ?? ''));
    const baseURL = validateApiBaseURL(String(base_url ?? ''));
    const key = api_key ? String(api_key).trim() : undefined;
    const content = await readRepoFile(APIS_REPO_FILE);
    const updated = addApiRegistryEntry(content, apiName, baseURL, key);
    await writeRepoFile(APIS_REPO_FILE, updated, false);
    return (
      `Added API "${apiName}" → ${baseURL}` +
      (key ? ' (with API key)' : '') +
      `. Registry: ${APIS_REPO_FILE}. Command modules can use it right away ` +
      `via createUrl('${apiName}', ...). ${saveChangesHint()}`
    );
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};
