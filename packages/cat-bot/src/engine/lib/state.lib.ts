/**
 * State Store — In-memory conversation flow tracker.
 * 15-minute sliding TTL; abandoned flows auto-expire rather than leaking.
 * In-memory only: a bot restart resetting in-progress flows is acceptable UX.
 */

import { TTLMap } from '@/engine/lib/ttl-map.lib.js';

export interface StateEntry {
  command: string;
  state: string | string[];
  context: Record<string, unknown>;
}

const store = new TTLMap<StateEntry>({
  ttlMs: 15 * 60 * 1000,
  sliding: true,
  cleanupIntervalMs: 5 * 60 * 1000,
});

export const stateStore = {
  create(id: string, data: StateEntry): void {
    store.set(id, data);
  },
  /** Returns null on cache miss or expiry. A hit resets the 15-minute window. */
  get(id: string): StateEntry | null {
    return store.get(id) ?? null;
  },
  delete(id: string): void {
    store.delete(id);
  },
};
