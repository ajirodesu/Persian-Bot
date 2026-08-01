/**
 * Slash Command Sync Registry — REST Toggle → Live Platform Bridge
 *
 * Decoupled registry that lets the REST controller trigger slash command re-registration on live
 * Discord/Telegram sessions without importing any platform transport code (Discord.js, grammY).
 *
 * Contract:
 *   - Discord/Telegram adapters register a callback on start() that captures platform client + commands Map.
 *   - The controller calls triggerSlashSync(key) after every setCommandEnabled().
 *   - Platforms without slash commands (FB Messenger) → triggerSlashSync is a no-op.
 *   - Callbacks skip the API call when prefix !== '/'.
 *
 * Key format: `${userId}:${platform}:${sessionId}` — matches the sessionManager key.
 */

type SlashSyncFn = () => Promise<void>;
const registry = new Map<string, SlashSyncFn>();

/** Register a slash sync callback for a session. Called on adapter start(). */
export function registerSlashSync(key: string, fn: SlashSyncFn): void {
  registry.set(key, fn);
}

/** Remove the slash sync callback. Called on adapter stop() to prevent stale entries. */
export function unregisterSlashSync(key: string): void {
  registry.delete(key);
}

/** Trigger slash sync for the given session. No-op when no callback is registered. */
export async function triggerSlashSync(key: string): Promise<void> {
  const fn = registry.get(key);
  if (fn) await fn();
}
