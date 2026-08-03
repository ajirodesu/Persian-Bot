import { useState, useEffect, useCallback } from 'react'
import { botService } from '@/features/users/services/bot.service'

interface UseBotReactionEmojiReturn {
  emoji: string
  isLoading: boolean
  isSaving: boolean
  error: string | null
  // Optimistic update: flips local state immediately, calls the API in the
  // background, reverts on failure — same value the command dispatcher reads.
  // Resolves true when the server accepted the new value.
  save: (emoji: string) => Promise<boolean>
}

export function useBotReactionEmoji(
  sessionId: string,
): UseBotReactionEmojiReturn {
  const [emoji, setEmoji] = useState('')
  const [isLoading, setIsLoading] = useState(() => !!sessionId)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) {
      return
    }
    let cancelled = false

    const fetchState = async (): Promise<void> => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await botService.getReactionEmoji(sessionId)
        if (!cancelled) setEmoji(result.emoji)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load reaction emoji',
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

  const save = useCallback(
    async (next: string): Promise<boolean> => {
      const previous = emoji
      setEmoji(next)
      setIsSaving(true)
      setError(null)
      try {
        const result = await botService.setReactionEmoji(sessionId, next)
        setEmoji(result.emoji)
        return true
      } catch (err) {
        setEmoji(previous)
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to update reaction emoji',
        )
        return false
      } finally {
        setIsSaving(false)
      }
    },
    [sessionId, emoji],
  )

  return { emoji, isLoading, isSaving, error, save }
}
