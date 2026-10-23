/**
 * Author: AjiroDesu
 *
 * Central TanStack Query client + key factory for the dashboard.
 *
 * Caching contract:
 * - staleTime 30s: mounted components render cached data instantly and
 *   revalidate silently in the background — no full-page spinners on
 *   revisit or route switching.
 * - gcTime 10min: recently visited pages stay warm in memory.
 * - refetchOnWindowFocus / refetchOnReconnect: stale-while-revalidate
 *   on return, matching the app's real-time (socket) posture elsewhere.
 * - retry 1: a single retry for transient blips; auth/validation errors
 *   surface immediately instead of spinning through retries.
 * - Query functions receive TanStack's AbortSignal — services forward it
 *   to apiClient so stale in-flight requests are actually cancelled,
 *   not just ignored.
 */
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
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
  adminUsers: (page: number, limit: number, search: string) =>
    ['admin', 'users', page, limit, search] as const,
  adminBots: (page: number, limit: number, search: string) =>
    ['admin', 'bots', page, limit, search] as const,
}
