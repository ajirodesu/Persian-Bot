/**
 * Admin-Only Repo — session-wide "Bot Admin Only" mode + its ignore list.
 *
 * Single source of truth for the logic previously inlined only inside
 * admin-only-mode.ts (`/adminonly`) and ignore-admin-only.ts (`/ignoreonlyad`).
 * Both those command handlers AND the web dashboard (bot-session-config
 * controller's admin-only endpoints) call into these same functions, so the
 * web "Bot Admin Only" switch and "Ignore Admin-Only" per-command switches
 * behave EXACTLY like their command counterparts — same DB fields, same
 * collection bootstrap, same cache invalidation for immediate live effect.
 *
 * Schema (db.bot → 'session_settings' collection):
 *   adminOnlyEnabled     boolean
 *   adminOnlyHideNoti    boolean
 *   adminOnlyIgnoreList  string[]
 */
import { createBotCollectionManager } from '@/engine/lib/db-collection.lib.js';
import {
  setCachedSessionAdminOnly,
  invalidateSessionAdminOnly,
} from '@/engine/lib/admin-only-state.lib.js';

const SETTINGS_COLLECTION = 'session_settings';

/** Bootstraps the shared session_settings collection on first use — mirrors admin-only-mode.ts's getHandle. */
async function getSessionSettingsHandle(
  userId: string,
  platform: string,
  sessionId: string,
) {
  const coll = createBotCollectionManager(userId, platform, sessionId);
  if (!(await coll.isCollectionExist(SETTINGS_COLLECTION))) {
    await coll.createCollection(SETTINGS_COLLECTION);
    const h = await coll.getCollection(SETTINGS_COLLECTION);
    await h.set('adminOnlyEnabled', false);
    await h.set('adminOnlyHideNoti', false);
    await h.set('adminOnlyIgnoreList', []);
    return h;
  }
  return coll.getCollection(SETTINGS_COLLECTION);
}

/** Returns whether session-wide "Bot Admin Only" mode is currently enabled. */
export async function getSessionAdminOnlyEnabled(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<boolean> {
  const handle = await getSessionSettingsHandle(userId, platform, sessionId);
  return ((await handle.get('adminOnlyEnabled')) as boolean | null) ?? false;
}

/**
 * Enables/disables session-wide "Bot Admin Only" mode — identical logic to
 * `/adminonly on|off` (minus the reply message, which only the command sends).
 * Invalidates the LRU fast-path flag immediately so the very next command
 * (from any platform, any thread) sees the fresh value — real-time effect,
 * not just on the next cache TTL expiry.
 */
export async function setSessionAdminOnlyEnabled(
  userId: string,
  platform: string,
  sessionId: string,
  enabled: boolean,
): Promise<void> {
  const handle = await getSessionSettingsHandle(userId, platform, sessionId);
  await handle.set('adminOnlyEnabled', enabled);
  // Keep the fast-path cache in sync rather than merely invalidating — saves the
  // next enforceAdminOnly call a redundant DB read when we already know the value.
  setCachedSessionAdminOnly(userId, platform, sessionId, enabled);
  invalidateSessionAdminOnly(userId, platform, sessionId);
}

/** Returns the current session-wide admin-only ignore list (command names exempt from the restriction). */
export async function getSessionAdminOnlyIgnoreList(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const handle = await getSessionSettingsHandle(userId, platform, sessionId);
  return ((await handle.get('adminOnlyIgnoreList')) as string[] | null) ?? [];
}

/**
 * Adds/removes a command name from the session-wide admin-only ignore list —
 * identical logic to `/ignoreonlyad add|del <commandName>` (minus the reply
 * message). Idempotent: adding an already-ignored command or removing an
 * absent one is a no-op write.
 */
export async function setCommandIgnoredFromAdminOnly(
  userId: string,
  platform: string,
  sessionId: string,
  commandName: string,
  ignored: boolean,
): Promise<void> {
  const name = commandName.toLowerCase();
  const handle = await getSessionSettingsHandle(userId, platform, sessionId);
  const list =
    ((await handle.get('adminOnlyIgnoreList')) as string[] | null) ?? [];
  const has = list.includes(name);

  if (ignored && !has) {
    list.push(name);
    await handle.set('adminOnlyIgnoreList', list);
  } else if (!ignored && has) {
    await handle.set(
      'adminOnlyIgnoreList',
      list.filter((n) => n !== name),
    );
  }
  // No LRU entry to invalidate here — enforceAdminOnly reads adminOnlyIgnoreList
  // fresh from settings on every enabled-mode check (only the boolean flag itself
  // is fast-path cached), so this takes effect on the very next command.
}
