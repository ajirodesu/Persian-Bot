/**
 * Command Hash Utility — Deterministic Slash-Menu Fingerprint
 *
 * Derives a SHA-256 hex digest from the loaded commands map so platform
 * slash-command registration modules can detect stale menus without
 * triggering a REST round-trip on every restart.
 *
 * Only commands that export onCommand are hashed — they are the exact entries
 * that appear in Discord's '/' menu and Telegram's command list. onChat-only
 * modules (auto-responses, ambient listeners) never modify the menu, so meta
 * changes in them must NOT invalidate the hash and force unnecessary API calls.
 *
 * Dependency direction: utils/command-hash.util.ts → node:crypto (built-in)
 * Zero external imports — safe to import from any layer without circular risk.
 */

import { createHash } from 'node:crypto';

/**
 * Computes a SHA-256 hex digest over the meta exports of all slash-eligible
 * command modules.
 *
 * Determinism guarantee: metas are sorted by name before serialisation so
 * the hash is identical regardless of the non-deterministic order in which
 * dynamic imports resolve across restarts.
 */
export function computeCommandHash(
  commands: Map<string, Record<string, unknown>>,
): string {
  const metas = [...commands.entries()]
    // Include only modules that expose a slash-command handler — these are the
    // entries that actually appear in the Discord / Telegram command menu.
    .filter(([, mod]) => typeof mod['onCommand'] === 'function')
    .map(([key, mod]) => ({
      key,
      meta: mod['meta'] as Record<string, unknown>,
    }))
    // Sort by key: dynamic import resolution order is non-deterministic, so
    // without sorting the same set of commands could produce different hashes.
    // Using the map key ensures aliases are hashed uniquely alongside canonical names.
    .sort((a, b) => a.key.localeCompare(b.key));

  return createHash('sha256').update(JSON.stringify(metas)).digest('hex');
}
