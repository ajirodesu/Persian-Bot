/**
 * Collection Library — named per-user-session JSON data stores
 *
 * Provides a rich dot-path CRUD surface on top of the `data` TEXT column in
 * bot_users_session. Each "collection" is a top-level key in that JSON blob.
 *
 * Usage from command handlers:
 *   const userColl = db.users.collection(senderID);    // scoped to session
 *   await userColl.createCollection('daily');
 *   const daily = await userColl.getCollection('daily');
 *   await daily.set('cooldown', Date.now());
 *
 * Design decisions:
 *   - Read-modify-write on every mutation — simplest correct model for SQLite without
 *     distributed transactions; acceptable for single-process bot deployments.
 *   - Every read-modify-write runs under a per-blob in-process lock (withBlobLock), so
 *     concurrent mutations to the same session row are applied in order and no write is
 *     lost; the read happens INSIDE the lock, after any queued predecessor write.
 *   - writeAll persists the full data blob with the patched collection key so
 *     concurrent mutations to DIFFERENT collections in the same session don't clobber each other.
 *   - All dot-path operations are pure in-memory; only the top-level read/write hits the DB.
 *   - Business logic (cooldown math, reward amounts) lives in command modules, never here.
 */

import {
  getUserSessionData,
  setUserSessionData,
} from '@/engine/repos/users.repo.js';
import {
  getThreadSessionData,
  setThreadSessionData,
} from '@/engine/repos/threads.repo.js';
import {
  getBotSessionData,
  setBotSessionData,
} from '@/engine/repos/session.repo.js';

// ── Dot-path helpers ──────────────────────────────────────────────────────────

function parsePath(path: string): string[] {
  return path.split('.').filter(Boolean);
}

/** Traverses obj by dot-separated path. Returns undefined for any missing segment. */
function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const key of parsePath(path)) {
    if (cur === null || cur === undefined || typeof cur !== 'object')
      return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Sets value at dot-path, creating intermediate objects as needed. */
function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = parsePath(path);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!; // safe: i is always < parts.length - 1
    if (typeof cur[key] !== 'object' || cur[key] === null) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  const lastKey = parts.at(-1)!; // safe: parts.length > 0 guarded above
  cur[lastKey] = value;
}

/** Removes the value at dot-path. Silently no-ops on missing intermediate segments. */
function deleteByPath(obj: Record<string, unknown>, path: string): void {
  const parts = parsePath(path);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof cur[key] !== 'object' || cur[key] === null) return;
    cur = cur[key] as Record<string, unknown>;
  }
  delete cur[parts.at(-1)!];
}

// ── Per-blob write serialization ──────────────────────────────────────────────

/**
 * In-process mutex registry, keyed by the identity of the underlying data
 * blob (user/thread/bot session row). Every read-modify-write cycle on a
 * blob runs under its lock, so two concurrent command handlers mutating the
 * same session's data (e.g. a balance credit racing an XP award) apply their
 * patches in order instead of both reading the old blob and one write being
 * silently lost. The bot is single-process, so an in-process lock is
 * sufficient. Entries self-delete once the tail promise settles — the map
 * only holds locks with queued writers.
 */
const blobLocks = new Map<string, Promise<unknown>>();

function withBlobLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = blobLocks.get(key) ?? Promise.resolve();
  // Run fn whether the predecessor succeeded or failed.
  const next = prev.then(fn, fn);
  blobLocks.set(key, next);
  void next
    .catch(() => {})
    .then(() => {
      if (blobLocks.get(key) === next) blobLocks.delete(key);
    });
  return next;
}

// ── Public types ──────────────────────────────────────────────────────────────

/** Rich CRUD surface for a single named collection within a user session's data blob. */
export interface CollectionHandle {
  // Nested object / array operations
  get(path?: string): Promise<unknown>;
  /**
   * Returns the full collection object (or a sub-object at path) in a single readAll() call.
   * Use instead of multiple get() calls when reading several fields from the same collection. */
  getAll(path?: string): Promise<Record<string, unknown>>;
  set(path: string, value: unknown): Promise<void>;
  /** Shallow-merges value when both existing and new are objects; overwrites otherwise. */
  update(path: string, value: unknown): Promise<void>;
  delete(path?: string): Promise<void>;
  push(path: string, value: unknown): Promise<void>;
  pull(path: string, value: unknown): Promise<void>;
  unshift(path: string, value: unknown): Promise<void>;
  shift(path: string): Promise<unknown>;
  pop(path: string): Promise<unknown>;
  /** Removes 1 element at index and inserts items in its place. Returns removed elements. */
  splice(path: string, index: number, ...items: unknown[]): Promise<unknown[]>;
  find(path: string, predicate: (item: unknown) => boolean): Promise<unknown[]>;
  findOne(
    path: string,
    predicate: (item: unknown) => boolean,
  ): Promise<unknown>;

  // Primitive (single-value) operations
  increment(path: string, amount?: number): Promise<void>;
  decrement(path: string, amount?: number): Promise<void>;
  reset(path: string, defaultValue: unknown): Promise<void>;
  exists(path: string): Promise<boolean>;

  // Metadata & utilities
  keys(path?: string): Promise<string[]>;
  length(path: string): Promise<number>;
  clear(path?: string): Promise<void>;
  /** Unconditional set (create or replace). Semantically distinct from update for clarity. */
  upsert(path: string, value: unknown): Promise<void>;
  /** Always shallow-merges into existing object; no-ops gracefully on non-object targets. */
  merge(path: string, value: Record<string, unknown>): Promise<void>;
}

/** Collection namespace for a specific bot_users_session row (scoped by botUserId). */
export interface CollectionManager {
  isCollectionExist(name: string): Promise<boolean>;
  createCollection(name: string): Promise<void>;
  getCollection(name: string): Promise<CollectionHandle>;
}

// ── Internal factory ──────────────────────────────────────────────────────────

function createCollectionHandle(
  collectionName: string,
  readAll: () => Promise<Record<string, unknown>>,
  writeAll: (data: Record<string, unknown>) => Promise<void>,
  lockKey: string,
): CollectionHandle {
  /** Reads only the named collection from the full data blob. Returns {} when absent. */
  const readCollection = async (): Promise<Record<string, unknown>> => {
    const data = await readAll();
    const col = data[collectionName];
    if (typeof col !== 'object' || col === null || Array.isArray(col))
      return {};
    return col as Record<string, unknown>;
  };

  /** Returned by a mutator to skip the write-back entirely (no-op path). */
  const SKIP = Symbol('skip-write');

  /**
   * One serialized read-modify-write against this collection: while the
   * per-blob lock is held, the collection is read FRESH, `mutate` is applied,
   * and the patched full blob is written back. Because the read happens under
   * the lock, concurrent mutations to the same blob (any collection in it)
   * are ordered instead of racing — the previous read-then-write pattern lost
   * one write whenever two commands mutated a session concurrently.
   */
  const mutateCollection = async <T>(
    mutate: (col: Record<string, unknown>) => T,
  ): Promise<T> =>
    withBlobLock(lockKey, async () => {
      const col = await readCollection();
      const result = mutate(col);
      if (result !== (SKIP as unknown as T)) {
        const data = await readAll();
        data[collectionName] = col;
        await writeAll(data);
      }
      return result;
    });

  return {
    async get(path?: string): Promise<unknown> {
      const col = await readCollection();
      if (!path) return col;
      return getByPath(col, path);
    },

    // Reads the entire collection (or sub-object at path) in one readAll() call so callers
    // that need multiple fields avoid N independent cache lookups through the repo layer.
    async getAll(path?: string): Promise<Record<string, unknown>> {
      const col = await readCollection();
      if (!path) return col;
      const sub = getByPath(col, path);
      if (typeof sub !== 'object' || sub === null || Array.isArray(sub))
        return {};
      return sub as Record<string, unknown>;
    },

    async set(path: string, value: unknown): Promise<void> {
      await mutateCollection((col) => {
        setByPath(col, path, value);
      });
    },

    async update(path: string, value: unknown): Promise<void> {
      await mutateCollection((col) => {
        const existing = getByPath(col, path);
        // Shallow merge when both sides are objects; overwrite for primitives and arrays
        if (
          typeof existing === 'object' &&
          existing !== null &&
          !Array.isArray(existing) &&
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value)
        ) {
          setByPath(col, path, { ...(existing as object), ...(value as object) });
        } else {
          setByPath(col, path, value);
        }
      });
    },

    async delete(path?: string): Promise<void> {
      await mutateCollection((col) => {
        if (!path) {
          // Clear the whole collection in place (was writeCollection({})).
          for (const key of Object.keys(col)) delete col[key];
          return;
        }
        deleteByPath(col, path);
      });
    },

    async push(path: string, value: unknown): Promise<void> {
      await mutateCollection((col) => {
        const arr = getByPath(col, path);
        setByPath(col, path, Array.isArray(arr) ? [...arr, value] : [value]);
      });
    },

    async pull(path: string, value: unknown): Promise<void> {
      await mutateCollection((col) => {
        const arr = getByPath(col, path);
        if (!Array.isArray(arr)) return SKIP as unknown as void;
        setByPath(
          col,
          path,
          arr.filter((item) => item !== value),
        );
      });
    },

    async unshift(path: string, value: unknown): Promise<void> {
      await mutateCollection((col) => {
        const arr = getByPath(col, path);
        setByPath(col, path, Array.isArray(arr) ? [value, ...arr] : [value]);
      });
    },

    async shift(path: string): Promise<unknown> {
      const result = await mutateCollection((col) => {
        const arr = getByPath(col, path);
        if (!Array.isArray(arr) || arr.length === 0)
          return SKIP as unknown as undefined;
        const first = arr[0]; // noUncheckedIndexedAccess: unknown | undefined; arr.length > 0 guarantees defined
        setByPath(col, path, arr.slice(1));
        return first;
      });
      // SKIP (empty/absent array) surfaces as undefined, never the sentinel.
      return result === (SKIP as unknown) ? undefined : result;
    },

    async pop(path: string): Promise<unknown> {
      const result = await mutateCollection((col) => {
        const arr = getByPath(col, path);
        if (!Array.isArray(arr) || arr.length === 0)
          return SKIP as unknown as undefined;
        const last = arr.at(-1); // arr.length > 0 guarantees defined
        setByPath(col, path, arr.slice(0, -1));
        return last;
      });
      return result === (SKIP as unknown) ? undefined : result;
    },

    async splice(
      path: string,
      index: number,
      ...items: unknown[]
    ): Promise<unknown[]> {
      const result = await mutateCollection((col) => {
        const arr = getByPath(col, path);
        if (!Array.isArray(arr)) return SKIP as unknown as unknown[];
        // Mutates arr in-place: removes 1 element at index, inserts items there
        const removed = (arr as unknown[]).splice(index, 1, ...items);
        setByPath(col, path, arr);
        return removed;
      });
      return result === (SKIP as unknown) ? [] : (result as unknown[]);
    },

    async find(
      path: string,
      predicate: (item: unknown) => boolean,
    ): Promise<unknown[]> {
      const col = await readCollection();
      const arr = getByPath(col, path);
      if (!Array.isArray(arr)) return [];
      return arr.filter(predicate);
    },

    async findOne(
      path: string,
      predicate: (item: unknown) => boolean,
    ): Promise<unknown> {
      const col = await readCollection();
      const arr = getByPath(col, path);
      if (!Array.isArray(arr)) return undefined;
      return arr.find(predicate);
    },

    async increment(path: string, amount = 1): Promise<void> {
      await mutateCollection((col) => {
        const val = getByPath(col, path);
        setByPath(col, path, (typeof val === 'number' ? val : 0) + amount);
      });
    },

    async decrement(path: string, amount = 1): Promise<void> {
      await mutateCollection((col) => {
        const val = getByPath(col, path);
        setByPath(col, path, (typeof val === 'number' ? val : 0) - amount);
      });
    },

    async reset(path: string, defaultValue: unknown): Promise<void> {
      await mutateCollection((col) => {
        setByPath(col, path, defaultValue);
      });
    },

    async exists(path: string): Promise<boolean> {
      const col = await readCollection();
      return getByPath(col, path) !== undefined;
    },

    async keys(path?: string): Promise<string[]> {
      const col = await readCollection();
      const target = path ? getByPath(col, path) : col;
      if (
        typeof target !== 'object' ||
        target === null ||
        Array.isArray(target)
      )
        return [];
      return Object.keys(target as object);
    },

    async length(path: string): Promise<number> {
      const col = await readCollection();
      const target = getByPath(col, path);
      if (Array.isArray(target)) return target.length;
      if (typeof target === 'object' && target !== null)
        return Object.keys(target).length;
      return 0;
    },

    async clear(path?: string): Promise<void> {
      await mutateCollection((col) => {
        if (!path) {
          for (const key of Object.keys(col)) delete col[key];
          return;
        }
        const target = getByPath(col, path);
        if (Array.isArray(target)) {
          setByPath(col, path, []);
        } else if (typeof target === 'object' && target !== null) {
          setByPath(col, path, {});
        } else {
          return SKIP as unknown as void;
        }
      });
    },

    async upsert(path: string, value: unknown): Promise<void> {
      await mutateCollection((col) => {
        setByPath(col, path, value);
      });
    },

    async merge(path: string, value: Record<string, unknown>): Promise<void> {
      await mutateCollection((col) => {
        const existing = getByPath(col, path);
        if (
          typeof existing === 'object' &&
          existing !== null &&
          !Array.isArray(existing)
        ) {
          setByPath(col, path, { ...(existing as object), ...value });
        } else {
          // Target is absent or not an object — initialise with the provided value
          setByPath(col, path, value);
        }
      });
    },
  };
}

// ── Public factory ────────────────────────────────────────────────────────────

/**
 * Returns a factory function bound to (sessionOwnerUserId, platform, sessionId).
 * Call the returned function with botUserId to get a CollectionManager scoped to
 * that specific bot_users_session row.
 *
 * Called once per message/event in the handler layer so command modules never
 * need to know session context coordinates.
 */
export function createCollectionManager(
  sessionOwnerUserId: string,
  platform: string,
  sessionId: string,
): (botUserId: string) => CollectionManager {
  return (botUserId: string): CollectionManager => {
    const readAll = () =>
      getUserSessionData(sessionOwnerUserId, platform, sessionId, botUserId);
    const writeAll = (data: Record<string, unknown>) =>
      setUserSessionData(
        sessionOwnerUserId,
        platform,
        sessionId,
        botUserId,
        data,
      );
    const lockKey = `u:${sessionOwnerUserId}:${platform}:${sessionId}:${botUserId}`;

    return {
      async isCollectionExist(name: string): Promise<boolean> {
        const data = await readAll();
        return Object.prototype.hasOwnProperty.call(data, name);
      },

      async createCollection(name: string): Promise<void> {
        await withBlobLock(lockKey, async () => {
          const data = await readAll();
          // Idempotent — never overwrites an existing collection
          if (!Object.prototype.hasOwnProperty.call(data, name)) {
            data[name] = {};
            await writeAll(data);
          }
        });
      },

      async getCollection(name: string): Promise<CollectionHandle> {
        return createCollectionHandle(name, readAll, writeAll, lockKey);
      },
    };
  };
}

/**
 * Returns a CollectionManager bound to (sessionOwnerUserId, platform, sessionId).
 * Since bot sessions are global to the credential identity, it requires no inner ID closures,
 * enabling direct usage like `db.bot.getCollection('name')`.
 *
 * WHY: Provides a globally scoped data store for the bot instance (e.g. global config, AI persona state)
 * separate from user-specific or thread-specific data.
 */
export function createBotCollectionManager(
  sessionOwnerUserId: string,
  platform: string,
  sessionId: string,
): CollectionManager {
  const readAll = () =>
    getBotSessionData(sessionOwnerUserId, platform, sessionId);
  const writeAll = (data: Record<string, unknown>) =>
    setBotSessionData(sessionOwnerUserId, platform, sessionId, data);
  const lockKey = `b:${sessionOwnerUserId}:${platform}:${sessionId}`;

  return {
    async isCollectionExist(name: string): Promise<boolean> {
      const data = await readAll();
      return Object.prototype.hasOwnProperty.call(data, name);
    },

    async createCollection(name: string): Promise<void> {
      await withBlobLock(lockKey, async () => {
        const data = await readAll();
        // Idempotent — never overwrites an existing collection
        if (!Object.prototype.hasOwnProperty.call(data, name)) {
          data[name] = {};
          await writeAll(data);
        }
      });
    },

    async getCollection(name: string): Promise<CollectionHandle> {
      return createCollectionHandle(name, readAll, writeAll, lockKey);
    },
  };
}
/**
 * Returns a factory function bound to (sessionOwnerUserId, platform, sessionId).
 * Call the returned function with botThreadId to get a CollectionManager scoped to
 * that specific bot_threads_session row.
 *
 * Symmetric with createCollectionManager but reads/writes bot_threads_session.data
 * instead of bot_users_session.data — enables per-thread feature flags like the
 * rankup notification toggle without a separate database table.
 *
 * Called once per message/event in the handler layer so command modules never
 * need to know session context coordinates.
 */
export function createThreadCollectionManager(
  sessionOwnerUserId: string,
  platform: string,
  sessionId: string,
): (botThreadId: string) => CollectionManager {
  return (botThreadId: string): CollectionManager => {
    const readAll = () =>
      getThreadSessionData(
        sessionOwnerUserId,
        platform,
        sessionId,
        botThreadId,
      );
    const writeAll = (data: Record<string, unknown>) =>
      setThreadSessionData(
        sessionOwnerUserId,
        platform,
        sessionId,
        botThreadId,
        data,
      );
    const lockKey = `t:${sessionOwnerUserId}:${platform}:${sessionId}:${botThreadId}`;

    return {
      async isCollectionExist(name: string): Promise<boolean> {
        const data = await readAll();
        return Object.prototype.hasOwnProperty.call(data, name);
      },

      async createCollection(name: string): Promise<void> {
        await withBlobLock(lockKey, async () => {
          const data = await readAll();
          // Idempotent — never overwrites an existing collection
          if (!Object.prototype.hasOwnProperty.call(data, name)) {
            data[name] = {};
            await writeAll(data);
          }
        });
      },

      async getCollection(name: string): Promise<CollectionHandle> {
        return createCollectionHandle(name, readAll, writeAll, lockKey);
      },
    };
  };
}
