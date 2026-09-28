/**
 * AI Blocked Commands — deny-list for commands that must NEVER be exposed
 * as generic AI tools, regardless of the caller's role.
 *
 * Rationale: Needle 3 only nominates tool calls; Persian-Bot executes them.
 * Commands like `shell` (arbitrary command execution) and `eval` (arbitrary
 * code execution) would turn any prompt-injection or confused-deputy path
 * into full host compromise. System-admin gates alone are insufficient —
 * the AI must not be able to run them on anyone's behalf.
 *
 * Defaults: shell (+ its `terminal` alias resolves to the same canonical
 * name), eval. Extend via NEEDLE_BLOCKED_COMMANDS (comma-separated,
 * canonical names, case-insensitive) — it can only ADD entries, never
 * remove the built-ins.
 *
 * Enforcement points (defense in depth):
 *   1. command-catalog.lib.ts — hidden from the AI-visible catalogue
 *   2. agent-command-guard.lib.ts — hard block with an AI-readable reason
 *      (test_command calls the guard, so interception is covered too)
 */

const BUILT_IN_BLOCKED = ['shell', 'eval'];

function parseExtraBlocked(): string[] {
  const raw = process.env['NEEDLE_BLOCKED_COMMANDS'] ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '');
}

let cached: Set<string> | null = null;

/** Returns the canonical-name deny set (built-ins + env additions). */
export function getBlockedCommands(): Set<string> {
  if (!cached) {
    cached = new Set([
      ...BUILT_IN_BLOCKED,
      ...parseExtraBlocked(),
    ]);
  }
  return cached;
}

/** True when the canonical command name is denied to the AI. */
export function isBlockedCommand(canonicalName: string): boolean {
  return getBlockedCommands().has(canonicalName.toLowerCase());
}

/** Clears the cache (tests only). */
export function __clearBlockedCacheForTests(): void {
  cached = null;
}
