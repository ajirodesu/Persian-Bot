import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/lib/query-client.lib'
import adminService from '@/features/admin/services/admin.service'
import type { AdminMcpSkillDto } from '@/features/admin/services/admin.service'

export const adminMcpSkillsKey = ['admin', 'mcp-skills'] as const

interface UseAdminMcpSkillsReturn {
  items: AdminMcpSkillDto[]
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
  invalidate: () => Promise<void>
}

export function useAdminMcpSkills(): UseAdminMcpSkillsReturn {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: adminMcpSkillsKey,
    queryFn: ({ signal }) => adminService.getMcpSkills(signal),
  })

  return {
    items: data?.items ?? [],
    isLoading: isPending,
    error: error ? (error.message ?? 'Failed to load MCP & Skills') : null,
    refetch: async () => {
      await refetch()
    },
    invalidate: async () => {
      await queryClient.invalidateQueries({ queryKey: adminMcpSkillsKey })
    },
  }
}
