/**
 * Persisted cache tests — the "last known state" contract.
 *
 * A fresh load during an outage must restore real dashboard data, reject
 * corrupt or week-old payloads, and never throw on a hostile localStorage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  clearPersistedQueryCache,
  isPersistableQueryState,
  persistedCacheTimestamp,
  restoreQueryCache,
} from '@/lib/query-persistence.lib'
import { queryKeys } from '@/lib/query-client.lib'

const STORAGE_KEY = 'catbot:query-cache:v1'

function makeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
}

let storage: ReturnType<typeof makeStorage>

beforeEach(() => {
  storage = makeStorage()
  vi.stubGlobal('window', { localStorage: storage })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function writeEnvelope(entries: unknown[], savedAt = Date.now(), version = 1) {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version, savedAt, entries }))
}

describe('restoreQueryCache', () => {
  it('restores successful dashboard data with its original timestamp', () => {
    const updatedAt = Date.now() - 60_000
    writeEnvelope([{ key: queryKeys.bots, data: { bots: [{ sessionId: 's1' }] }, dataUpdatedAt: updatedAt }])
    const client = new QueryClient()

    restoreQueryCache(client)

    expect(client.getQueryData(queryKeys.bots)).toEqual({
      bots: [{ sessionId: 's1' }],
    })
    const state = client.getQueryState(queryKeys.bots)
    expect(state?.dataUpdatedAt).toBe(updatedAt)
  })

  it('ignores entries older than the TTL', () => {
    writeEnvelope(
      [{ key: queryKeys.bots, data: { bots: [] }, dataUpdatedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }],
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    )
    const client = new QueryClient()
    restoreQueryCache(client)
    expect(client.getQueryData(queryKeys.bots)).toBeUndefined()
  })

  it('discards a foreign cache version', () => {
    writeEnvelope([{ key: queryKeys.bots, data: { bots: [] }, dataUpdatedAt: Date.now() }], Date.now(), 99)
    const client = new QueryClient()
    restoreQueryCache(client)
    expect(client.getQueryData(queryKeys.bots)).toBeUndefined()
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('survives corrupt JSON and clears it', () => {
    storage.setItem(STORAGE_KEY, '{not json')
    const client = new QueryClient()
    expect(() => restoreQueryCache(client)).not.toThrow()
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('ignores non-dashboard query roots', () => {
    writeEnvelope([{ key: ['session'], data: { secret: true }, dataUpdatedAt: Date.now() }])
    const client = new QueryClient()
    restoreQueryCache(client)
    expect(client.getQueryData(['session'])).toBeUndefined()
  })

  it('reports the newest persisted timestamp', () => {
    const savedAt = Date.now() - 5_000
    writeEnvelope([], savedAt)
    expect(persistedCacheTimestamp()).toBe(savedAt)
  })
})

describe('isPersistableQueryState', () => {
  it('keeps data through a failed revalidation', () => {
    expect(isPersistableQueryState({ data: { bots: [] }, dataUpdatedAt: 1 })).toBe(true)
  })

  it('ignores queries that never produced data', () => {
    expect(isPersistableQueryState({ data: undefined, dataUpdatedAt: 0 })).toBe(false)
  })
})

describe('clearPersistedQueryCache', () => {
  it('removes the stored payload', () => {
    writeEnvelope([])
    clearPersistedQueryCache()
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })
})
