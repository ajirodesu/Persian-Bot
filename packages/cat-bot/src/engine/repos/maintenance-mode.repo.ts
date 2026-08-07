/**
 * Maintenance Mode Repo — LRU-cached global flag.
 *
 * Mirrors admin-only-state.lib.ts's fast-path pattern: the single boolean is
 * cached in the shared LRU so the per-command middleware read costs no DB hit
 * after the first check. setMaintenanceModeEnabled writes straight through to
 * the cache, so a dashboard toggle takes effect on the very next command — no
 * restart and no waiting out the TTL.
 *
 * Storage lives in the 'database' package (getMaintenanceModeEnabled /
 * setMaintenanceModeEnabled), persisted per-adapter (systemSettings doc /
 * system_settings row).
 */
import {
  getMaintenanceModeEnabled as _getMaintenanceModeEnabled,
  setMaintenanceModeEnabled as _setMaintenanceModeEnabled,
} from 'database';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

const MAINTENANCE_MODE_KEY = 'maintenance:mode:enabled';

/** Returns whether global Maintenance Mode is currently enabled (cached). */
export async function getMaintenanceModeEnabled(): Promise<boolean> {
  const cached = lruCache.get<boolean>(MAINTENANCE_MODE_KEY);
  if (cached !== undefined) return cached;
  const enabled = await _getMaintenanceModeEnabled();
  lruCache.set(MAINTENANCE_MODE_KEY, enabled);
  return enabled;
}

/**
 * Enables/disables global Maintenance Mode, then updates the cached flag
 * immediately so the very next command dispatch sees the fresh value.
 */
export async function setMaintenanceModeEnabled(enabled: boolean): Promise<void> {
  await _setMaintenanceModeEnabled(enabled);
  lruCache.set(MAINTENANCE_MODE_KEY, enabled);
}