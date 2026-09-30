import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-client.lib'
import { adminService } from '@/features/admin/services/admin.service'
import type {
  AdminUserItemDto,
  GetAdminUserListResponseDto,
} from '@/features/admin/services/admin.service'

interface UseAdminUsersReturn {
  users: AdminUserItemDto[]
  total: number
  totalPages: number
  stats: GetAdminUserListResponseDto['stats'] | null
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useAdminUsers(
  page = 1,
  limit = 10,
  search = '',
): UseAdminUsersReturn {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: queryKeys.adminUsers(page, limit, search),
    queryFn: ({ signal }) =>
      adminService.getAdminUsers(page, limit, search, signal),
    placeholderData: keepPreviousData,
  })

  return {
    users: data?.users ?? [],
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 0,
    stats: data?.stats ?? null,
    isLoading: isPending,
    error: error ? (error.message ?? 'Failed to load users') : null,
    refetch: async () => {
      await refetch()
    },
  }
}
