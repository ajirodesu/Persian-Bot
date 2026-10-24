/**
 * Author: AjiroDesu
 *
 * Persisted query cache — the dashboard's "last known state".
 *
 * Every successful dashboard query is mirrored into localStorage so a fresh
 * load during a backend outage still paints the last real data instead of a
 * blank page or an error screen. The cache is:
 * - scoped to dashboard query roots (`bots`, `admin`) — public/auth queries
 *   are never persisted;
 * - versioned, so a schema change discards old shapes instead of rendering
 *   them;
 * - TTL-bounded, so week-old data cannot masquerade as current;
 * - quota-safe, so a full storage device degrades to memory-only rather than
 *   breaking the app.
 *
 * Restore happens once, synchronously, before React mounts (see main.tsx) so
 * the first render already has data and never flashes a skeleton on revisit.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query'

const STORAGE_KEY = 'catbot:query-cache:v1'
const VERSION = 1
const TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_BYTES = 1_500_000
const PERSIST_DEBOUNCE_MS = 400
const PERSISTED_ROOTS = new Set(['bots', 'admin'])

interface PersistedEntry {
  key: QueryKey
  data: unknown
  dataUpdatedAt: number
}

interface PersistedEnvelope {
  version: number
  savedAt: number
  entries: PersistedEntry[]
}

function canPersist(key: QueryKey): boolean {
  if (!Array.isArray(key) || key.length === 0) return false
  return PERSISTED_ROOTS.has(String(key[0]))
}

function isPersistedEntry(value: unknown): value is PersistedEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<PersistedEntry>
  return (
    Array.isArray(entry.key) &&
    typeof entry.dataUpdatedAt === 'number' &&
    entry.data !== undefined
  )
}

/** Rehydrates persisted queries into the given client. Never throws. */
export function restoreQueryCache(client: QueryClient): void {
  if (typeof window === 'undefined') return
  let raw: string | null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return
  }
  if (!raw) return

  try {
    const envelope = JSON.parse(raw) as PersistedEnvelope
    if (envelope.version !== VERSION || !Array.isArray(envelope.entries)) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }
    const now = Date.now()
    for (const entry of envelope.entries) {
      if (!isPersistedEntry(entry) || !canPersist(entry.key)) continue
      if (now - entry.dataUpdatedAt > TTL_MS) continue
      client.setQueryData(entry.key, entry.data, {
        updatedAt: entry.dataUpdatedAt,
      })
    }
  } catch {
    // Corrupt cache is not worth crashing the app over.
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // storage unavailable — memory-only mode
    }
  }
}

/**
 * Data is worth persisting whenever it exists — including the error-with-data
 * state TanStack keeps after a failed revalidation. Filtering on
 * `status === 'success'` used to erase the last known list the moment a
 * refresh failed, which defeated the whole cache-fallback contract.
 */
export function isPersistableQueryState(state: {
  data: unknown
  dataUpdatedAt: number
}): boolean {
  return state.data !== undefined && state.dataUpdatedAt > 0
}

function serialize(client: QueryClient): string | null {
  const entries: PersistedEntry[] = []
  for (const query of client.getQueryCache().getAll()) {
    const { state } = query
    if (!isPersistableQueryState(state)) continue
    if (!canPersist(query.queryKey)) continue
    entries.push({
      key: query.queryKey,
      data: state.data,
      dataUpdatedAt: state.dataUpdatedAt,
    })
  }
  if (entries.length === 0) return null

  // Newest first; drop the oldest entries until the payload fits the budget.
  entries.sort((a, b) => b.dataUpdatedAt - a.dataUpdatedAt)
  let payload = JSON.stringify({
    version: VERSION,
    savedAt: Date.now(),
    entries,
  } satisfies PersistedEnvelope)
  while (payload.length > MAX_BYTES && entries.length > 1) {
    entries.pop()
    payload = JSON.stringify({
      version: VERSION,
      savedAt: Date.now(),
      entries,
    } satisfies PersistedEnvelope)
  }
  return payload
}

/**
 * Mirrors successful dashboard queries into localStorage. Returns a cleanup
 * function that unsubscribes and clears any pending timer.
 */
export function startQueryCachePersistence(client: QueryClient): () => void {
  if (typeof window === 'undefined') return () => undefined

  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const flush = () => {
    timer = null
    if (disposed) return
    const payload = serialize(client)
    try {
      if (payload === null) window.localStorage.removeItem(STORAGE_KEY)
      else window.localStorage.setItem(STORAGE_KEY, payload)
    } catch {
      // Quota or private-mode failure: keep working from memory.
    }
  }

  const schedule = () => {
    if (timer) return
    timer = setTimeout(flush, PERSIST_DEBOUNCE_MS)
  }

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return
    // Only successful data changes are worth a write.
    if (event.query.state.status === 'success') schedule()
  })

  // Backgrounded tabs may be frozen before the debounce fires; flush on the
  // way out so the persisted copy is as fresh as possible.
  const onPageHide = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    flush()
  }
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onPageHide)

  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    unsubscribe()
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('visibilitychange', onPageHide)
  }
}

/** Removes every persisted byte. Called on explicit sign-out. */
export function clearPersistedQueryCache(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // nothing to do
  }
}

/** Timestamp of the newest persisted dashboard query, or null. */
export function persistedCacheTimestamp(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const envelope = JSON.parse(raw) as PersistedEnvelope
    return typeof envelope.savedAt === 'number' ? envelope.savedAt : null
  } catch {
    return null
  }
}
