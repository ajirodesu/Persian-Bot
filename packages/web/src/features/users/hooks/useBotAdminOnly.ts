import { useState, useEffect, useCallback } from 'react'
import { botService } from '@/features/users/services/bot.service'

interface UseBotAdminOnlyReturn {
  enabled: boolean
  isLoading: boolean
  error: string | null
  // Optimistic update: flips local state immediately, calls the API in the background,
  // reverts on failure — same "Bot Admin Only" state the /adminonly command reads/writes.
  toggle: (enabled: boolean) => Promise<void>
}

export function useBotAdminOnly(sessionId: string): UseBotAdminOnlyReturn {
  const [enabled, setEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setIsLoading(false)
      return
    }
    let cancelled = false

    const fetchState = async (): Promise<void> => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await botService.getAdminOnly(sessionId)
        if (!cancelled) setEnabled(result.enabled)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load Bot Admin Only state',
          )
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void fetchState()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const toggle = useCallback(
    async (next: boolean): Promise<void> => {
      setEnabled(next)
      try {
        await botService.setAdminOnly(sessionId, next)
      } catch (err) {
        setEnabled(!next)
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to update Bot Admin Only state',
        )
      }
    },
    [sessionId],
  )

  return { enabled, isLoading, error, toggle }
}
