import { useState, useEffect, useCallback } from 'react'
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
  const [data, setData] = useState<GetAdminUserListResponseDto | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await adminService.getAdminUsers(page, limit, search)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setIsLoading(false)
    }
  }, [page, limit, search])

  useEffect(() => {
    void fetchUsers()
  }, [fetchUsers])

  return {
    users: data?.users ?? [],
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 0,
    stats: data?.stats ?? null,
    isLoading,
    error,
    refetch: fetchUsers,
  }
}
