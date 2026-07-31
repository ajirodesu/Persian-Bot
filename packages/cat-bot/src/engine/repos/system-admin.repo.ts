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
 * cache entry per sender. The 5-min TTL is a safety-net fallback only — the
 * addSystemAdmin/removeSystemAdmin wrappers below write straight through to this
 * same Set on every mutation, so a dashboard Add/Remove takes effect immediately
 * (next command or API call, any platform, any session) with no restart and no
 * waiting out the TTL. Callers (e.g. the admin controller) MUST mutate system
 * admins through these wrappers — not the bare 'database' package functions —
 * for that live-effect guarantee to hold.
 */
import {
  listSystemAdmins as _listSystemAdmins,
  addSystemAdmin as _addSystemAdmin,
  removeSystemAdmin as _removeSystemAdmin,
} from 'database';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

export interface SystemAdminItem {
  id: string;
  adminId: string;
  createdAt: string;
}

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
  const set = await getOrLoadSet();
  return set.has(adminId);
}

/** Loads the cached Set, populating it from the DB on first miss. */
async function getOrLoadSet(): Promise<Set<string>> {
  let set = lruCache.get<Set<string>>(SYSTEM_ADMIN_SET_KEY);
  if (set === undefined) {
    const rows = await _listSystemAdmins();
    set = new Set(rows.map((r: { adminId: string }) => r.adminId));
    lruCache.set(SYSTEM_ADMIN_SET_KEY, set);
  }
  return set;
}

// ── addSystemAdmin / removeSystemAdmin ──────────────────────────────────────────

/**
 * Registers a new global system admin, then immediately updates the shared
 * in-memory Set so the ID gains system-admin privileges on the very next
 * command dispatch or API call — no server restart, no waiting on the TTL.
 */
export async function addSystemAdmin(
  adminId: string,
): Promise<SystemAdminItem> {
  const admin: SystemAdminItem = await _addSystemAdmin(adminId);
  const set = await getOrLoadSet();
  set.add(adminId);
  return admin;
}

/**
 * Revokes a global system admin, then immediately updates the shared
 * in-memory Set so the ID loses system-admin privileges on the very next
 * command dispatch or API call — no server restart, no waiting on the TTL.
 */
export async function removeSystemAdmin(adminId: string): Promise<void> {
  await _removeSystemAdmin(adminId);
  const set = await getOrLoadSet();
  set.delete(adminId);
}
