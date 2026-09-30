import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-client.lib'
import { adminService } from '@/features/admin/services/admin.service'
import type { AdminBotItemDto } from '@/features/admin/services/admin.service'
import type { GetAdminBotsResponseDto } from '@/features/admin/services/admin.service'

interface UseAdminBotsReturn {
  bots: AdminBotItemDto[]
  total: number
  totalPages: number
  stats: GetAdminBotsResponseDto['stats'] | null
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useAdminBots(
  page = 1,
  limit = 10,
  search = '',
): UseAdminBotsReturn {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: queryKeys.adminBots(page, limit, search),
    queryFn: ({ signal }) =>
      adminService.getAdminBots(page, limit, search, signal),
    placeholderData: keepPreviousData,
  })

  return {
    bots: data?.bots ?? [],
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 0,
    stats: data?.stats ?? null,
    isLoading: isPending,
    error: error ? (error.message ?? 'Failed to load bot sessions') : null,
    refetch: async () => {
      await refetch()
    },
  }
}
