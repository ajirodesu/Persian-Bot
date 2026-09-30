import { useState, useCallback } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { queryClient, queryKeys } from '@/lib/query-client.lib'
import { botService } from '@/features/users/services/bot.service'
import type { BotEventItemDto } from '@/features/users/dtos/bot.dto'
import type { GetBotEventsResponseDto } from '@/features/users/dtos/bot.dto'

interface UseBotEventsReturn {
  events: BotEventItemDto[]
  total: number
  totalPages: number
  isLoading: boolean
  error: string | null
  toggleEvent: (name: string, isEnable: boolean) => Promise<void>
}

export function useBotEvents(
  sessionId: string,
  page = 1,
  limit = 12,
  search = '',
): UseBotEventsReturn {
  const key = queryKeys.botEvents(sessionId, page, limit, search)
  const [toggleError, setToggleError] = useState<string | null>(null)

  const { data, isPending, error } = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      botService.getEvents(sessionId, page, limit, search, signal),
    enabled: !!sessionId,
    placeholderData: keepPreviousData,
  })

  const toggleEvent = useCallback(
    async (name: string, isEnable: boolean): Promise<void> => {
      setToggleError(null)
      const patch = (
        prev: GetBotEventsResponseDto,
        value: boolean,
      ): GetBotEventsResponseDto => ({
        ...prev,
        events: prev.events.map((evt) =>
          evt.eventName === name ? { ...evt, isEnable: value } : evt,
        ),
      })
      for (const [cachedKey, cached] of queryClient.getQueriesData<GetBotEventsResponseDto>({
        queryKey: ['bots', sessionId, 'events'],
      })) {
        if (cached) queryClient.setQueryData(cachedKey, patch(cached, isEnable))
      }

      try {
        await botService.toggleEvent(sessionId, name, isEnable)
      } catch (err) {
        for (const [cachedKey, cached] of queryClient.getQueriesData<GetBotEventsResponseDto>({
          queryKey: ['bots', sessionId, 'events'],
        })) {
          if (cached) queryClient.setQueryData(cachedKey, patch(cached, !isEnable))
        }
        setToggleError(err instanceof Error ? err.message : 'Failed to toggle event')
      }
    },
    [sessionId],
  )

  return {
    events: data?.events ?? [],
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 0,
    isLoading: isPending,
    error:
      toggleError ?? (error ? (error.message ?? 'Failed to load events') : null),
    toggleEvent,
  }
}
