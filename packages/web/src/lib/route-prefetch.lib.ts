/* eslint-disable react-refresh/only-export-components */
import { useEffect, type RefObject } from 'react'
import { queryClient, queryKeys } from '@/lib/query-client.lib'
import { botService } from '@/features/users/services/bot.service'

/**
 * Author: AjiroDesu
 *
 * Route-chunk prefetching for instant route switches.
 *
 * Each loader re-imports the exact module the router lazy-loads, so Vite
 * emits no duplicate chunk — the prefetch simply warms the chunk the
 * navigation will need. Calls are deduped and failures are swallowed
 * (the navigation itself retries the import).
 *
 * Wire loaders to onMouseEnter + onFocus of navigation links: hovering a
 * sidebar item usually precedes the click by hundreds of milliseconds,
 * which is exactly enough to resolve the chunk before the transition.
 */
const prefetched = new Set<string>()

function prefetchChunk(key: string, loader: () => Promise<unknown>): void {
  if (prefetched.has(key)) return
  prefetched.add(key)
  void loader().catch(() => {
    prefetched.delete(key)
  })
}

export const prefetchDashboardHome = (): void =>
  prefetchChunk('dashboard-home', () => import('@/pages/dashboard'))

export const prefetchChatRoom = (): void =>
  prefetchChunk('chat-room', () => import('@/pages/dashboard/chat-room'))

export const prefetchAIAgent = (): void =>
  prefetchChunk('ai-agent', () => import('@/pages/dashboard/ai-agent'))

export const prefetchDashboardSettings = (): void =>
  prefetchChunk('dashboard-settings', () => import('@/pages/dashboard/settings'))

export const prefetchNewBot = (): void =>
  prefetchChunk('new-bot', () => import('@/pages/dashboard/create-new-bot'))

export const prefetchBotConsole = (): void =>
  prefetchChunk('bot-console', () => import('@/pages/dashboard/bot/index'))

export const prefetchBotCommands = (): void =>
  prefetchChunk('bot-commands', () => import('@/pages/dashboard/bot/commands'))

/**
 * Fires a prefetch loader once when the referenced element scrolls within
 * ~200px of the viewport — covers touch users (no hover) and below-fold
 * links the pointer never travels over.
 */
export function usePrefetchOnVisible(
  ref: RefObject<HTMLElement | null>,
  loader: (() => void) | undefined,
): void {
  useEffect(() => {
    if (!loader) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      loader()
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          loader()
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, loader])
}

/**
 * Warms both the bot console chunk and the bot's detail query for a
 * hovered/visible Bot Manager row — opening it then renders instantly.
 */
export const prefetchBotDetail = (sessionId: string): void => {
  prefetchChunk(`bot-console-${sessionId}`, () => import('@/pages/dashboard/bot/index'))
  void queryClient.prefetchQuery({
    queryKey: queryKeys.botDetail(sessionId),
    queryFn: ({ signal }) => botService.getBot(sessionId, signal),
  })
}
