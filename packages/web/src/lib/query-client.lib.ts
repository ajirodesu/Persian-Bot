/**
 * Author: AjiroDesu
 *
 * Central TanStack Query client + key factory for the dashboard.
 *
 * Resilience contract:
 * - staleTime 30s: mounted components render cached data instantly and
 *   revalidate silently in the background — no full-page spinners on
 *   revisit or route switching.
 * - gcTime 30min: recently visited pages stay warm in memory; combined with
 *   the localStorage mirror, "last known state" survives reloads.
 * - offlineFirst: the first attempt runs even when the browser reports
 *   offline (so a cached response can be served), then polling pauses and
 *   resumes on the `online` event instead of hammering a dead network.
 * - Exponential backoff with jitter, capped at 30s, at most 5 attempts, and
 *   `Retry-After` wins over the computed delay when the server sends one.
 * - Only retryable failures retry. 400/401/403/404/422 surface immediately,
 *   so auth problems open the re-auth modal instead of spinning.
 * - Query functions receive TanStack's AbortSignal — services forward it to
 *   apiClient so stale in-flight requests are actually cancelled.
 */
import { QueryClient } from '@tanstack/react-query'

export {
  MAX_QUERY_RETRIES,
  computeRetryDelay,
  shouldRetryQuery,
} from './retry.lib'
import { computeRetryDelay, shouldRetryQuery } from './retry.lib'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      networkMode: 'offlineFirst',
      retry: shouldRetryQuery,
      retryDelay: computeRetryDelay,
      // A restored cache is real data, but treat it as stale so the first
      // successful revalidation replaces it as soon as the server is back.
      refetchOnMount: true,
    },
    mutations: {
      // Writes are never retried automatically: a duplicate POST can create
      // duplicate sessions. Idempotent retries are an explicit UI action.
      retry: 0,
      networkMode: 'online',
    },
  },
})

export const queryKeys = {
  bots: ['bots'] as const,
  botDetail: (id: string) => ['bots', 'detail', id] as const,
  botCommands: (sessionId: string, page: number, limit: number, search: string) =>
    ['bots', sessionId, 'commands', page, limit, search] as const,
  botEvents: (sessionId: string, page: number, limit: number, search: string) =>
    ['bots', sessionId, 'events', page, limit, search] as const,
  botLogs: (sessionId: string) => ['bots', sessionId, 'logs'] as const,
  botDatabaseUsers: (sessionId: string, page: number, limit: number, search: string) =>
    ['bots', sessionId, 'database', 'users', page, limit, search] as const,
  botDatabaseGroups: (sessionId: string, page: number, limit: number, search: string) =>
    ['bots', sessionId, 'database', 'groups', page, limit, search] as const,
  adminUsers: (page: number, limit: number, search: string) =>
    ['admin', 'users', page, limit, search] as const,
  adminBots: (page: number, limit: number, search: string) =>
    ['admin', 'bots', page, limit, search] as const,
}
