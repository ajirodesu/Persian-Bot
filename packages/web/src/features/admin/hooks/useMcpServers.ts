import { useState, useEffect, useCallback } from 'react'
import { mcpServersService } from '@/features/admin/services/mcp-servers.service'
import type { AdminMcpServerDto } from '@/features/admin/services/mcp-servers.service'

interface UseMcpServersReturn {
  servers: AdminMcpServerDto[]
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useMcpServers(): UseMcpServersReturn {
  const [servers, setServers] = useState<AdminMcpServerDto[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchServers = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await mcpServersService.listServers()
      setServers(result.servers)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MCP servers')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-fetching: setState is deferred to .then/.catch microtasks
    void fetchServers()
  }, [fetchServers])

  return { servers, isLoading, error, refetch: fetchServers }
}