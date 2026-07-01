/**
 * System Admin Repo — LRU cache layer over the database adapter.
 *
 * isSystemAdmin is invoked on EVERY command dispatch via enforceNotBanned and
 * enforcePermission — once per command per unique sender. The old per-sender key
 * pattern (system:admin:check:${adminId}) created O(unique_senders) cache entries,
 * almost all storing `false`, crowding out genuinely useful cached data.
 *
 * New strategy: a single `system:admin:set` key holds a Set<string> of all system
 * admin IDs. Any isSystemAdmin call resolves via Set.has() in O(1) without a new
 * cache entry per sender. The 5-min TTL provides sufficient eventual consistency
 * since system admin mutations happen only through the dashboard, not in-chat.
 */
import { listSystemAdmins as _listSystemAdmins } from 'database';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

// ── Cache key ─────────────────────────────────────────────────────────────────
// One key for the entire system admin ID set regardless of how many unique
// senders are checked — O(1) entries instead of O(unique_senders) entries.

const SYSTEM_ADMIN_SET_KEY = 'system:admin:set';

// ── isSystemAdmin ──────────────────────────────────────────────────────────────

/**
 * Returns true when adminId is registered as a global system admin.
 * System admins bypass all role gates and ban enforcement across every session.
 *
 * Loads the full admin ID set on first miss and caches it under a single key.
 * Subsequent calls for any senderID — admin or not — resolve via Set.has()
 * without writing new cache entries.
 */
export async function isSystemAdmin(adminId: string): Promise<boolean> {
  let set = lruCache.get<Set<string>>(SYSTEM_ADMIN_SET_KEY);
  if (set === undefined) {
    const rows = await _listSystemAdmins();
    set = new Set(rows.map((r: { adminId: string }) => r.adminId));
    lruCache.set(SYSTEM_ADMIN_SET_KEY, set);
  }
  return set.has(adminId);
}
