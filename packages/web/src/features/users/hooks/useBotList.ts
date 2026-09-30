import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-client.lib'
import { botService } from '@/features/users/services/bot.service'
import type { GetBotListItemDto } from '@/features/users/dtos/bot.dto'

interface UseBotListReturn {
  bots: GetBotListItemDto[]
  isLoading: boolean
  error: string | null
}

export function useBotList(): UseBotListReturn {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.bots,
    // TanStack's signal aborts the fetch when a newer request supersedes it
    // or the last subscriber unmounts — stale requests are cancelled, not
    // merely ignored. Cached data renders instantly on revisit.
    queryFn: ({ signal }) => botService.listBots(signal),
  })

  return {
    bots: data?.bots ?? [],
    // isPending (not isFetching) so cached revisits and background
    // revalidations never flash a full-page spinner.
    isLoading: isPending,
    error: error ? (error.message ?? 'Failed to load bots') : null,
  }
}
