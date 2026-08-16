/**
 * AI Agent — Personalities
 *
 * Trigger-word logic for the agent. The agent's persona/system prompt lives in
 * the Cat-Bot style template at agent/system_prompt.md (loaded by the handler
 * and filled with per-user context) — this module only owns the activation
 * names: the per-user trigger word set in the dashboard AI Integration
 * settings ("Cat-Bot" when unset) plus extra names like the per-session bot
 * nickname.
 */

/** Default agent name (no env vars — web-config only). */
export const AGENT_NAME = 'Cat-Bot';

/**
 * Trigger words that activate the agent: the configured agent name (the
 * default "cat", or the per-user dashboard name via `overrideName`) plus any
 * extra names — e.g. the per-session bot nickname. All names are lower-cased
 * and de-duplicated, so whole-word matching is uniform. When a per-user name is
 * set it REPLACES the default (the dashboard setting wins).
 */
export function agentTriggerNames(
  extraNames: string[] = [],
  overrideName?: string,
): string[] {
  const primary = (overrideName ?? AGENT_NAME).trim().toLowerCase();
  const names = [primary, ...extraNames.map((n) => n.trim().toLowerCase())];
  return [...new Set(names.filter((n) => n.length > 0))];
}

/**
 * Returns true if the message text contains any trigger name (the agent name or
 * a passed extra name, e.g. the bot nickname) as a whole word — used for
 * natural-language activation without a prefix.
 */
export function detectActivation(
  text: string,
  extraNames: string[] = [],
  overrideName?: string,
): boolean {
  return agentTriggerNames(extraNames, overrideName).some((name) =>
    new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(text),
  );
}

/**
 * Removes a leading trigger name (agent name or nickname) from a message body
 * so the query sent to the LLM doesn't repeat the bot's own name.
 */
export function stripAgentTrigger(
  text: string,
  extraNames: string[] = [],
  overrideName?: string,
): string {
  const triggers = agentTriggerNames(extraNames, overrideName);
  if (triggers.length === 0) return text;
  const re = new RegExp(
    `^(?:${triggers.map((n) => escapeRegExp(n)).join('|')})\\b\\s*`,
    'i',
  );
  return text.replace(re, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
