import { useState, useEffect } from 'react'
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
  const [data, setData] = useState<GetAdminBotsResponseDto | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchBots = async (): Promise<void> => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await adminService.getAdminBots(page, limit, search)
        if (!cancelled) setData(result)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load bot sessions',
          )
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void fetchBots()
    return () => {
      cancelled = true
    }
  }, [page, limit, search])

  const refetch = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await adminService.getAdminBots(page, limit, search)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bots')
    } finally {
      setIsLoading(false)
    }
  }

  return {
    bots: data?.bots ?? [],
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 0,
    stats: data?.stats ?? null,
    isLoading,
    error,
    refetch,
  }
}
