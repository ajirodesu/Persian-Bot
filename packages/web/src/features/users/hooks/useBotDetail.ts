import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient, queryKeys } from '@/lib/query-client.lib'
import { botService } from '@/features/users/services/bot.service'
import type { GetBotDetailResponseDto } from '@/features/users/dtos/bot.dto'

interface UseBotDetailReturn {
  bot: GetBotDetailResponseDto | null
  setBot: React.Dispatch<React.SetStateAction<GetBotDetailResponseDto | null>>
  isLoading: boolean
  error: string | null
}

export function useBotDetail(id: string): UseBotDetailReturn {
  const key = queryKeys.botDetail(id)
  const { data, isPending, error } = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => botService.getBot(id, signal),
    enabled: !!id,
  })

  // Local-write escape hatch (used after settings saves) — writes straight
  // into the same cache the query reads, so UI and cache never diverge.
  const setBot = useCallback<UseBotDetailReturn['setBot']>(
    (action) => {
      queryClient.setQueryData<GetBotDetailResponseDto | undefined>(
        key,
        (prev) => {
          const current = prev ?? null
          const next =
            typeof action === 'function'
              ? (
                  action as (
                    p: GetBotDetailResponseDto | null,
                  ) => GetBotDetailResponseDto | null
                )(current)
              : action
          return next ?? undefined
        },
      )
    },
    [key],
  )

  return {
    bot: data ?? null,
    setBot,
    isLoading: isPending,
    error: error ? (error.message ?? 'Failed to load bot details') : null,
  }
}
