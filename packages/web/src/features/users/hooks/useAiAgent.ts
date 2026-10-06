import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-client.lib'
import { aiService } from '@/features/users/services/ai.service'

export function useAiStatus() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.aiStatus,
    queryFn: ({ signal }) => aiService.getStatus(signal),
  })
  return {
    status: data ?? null,
    isLoading: isPending,
    error: error ? (error.message ?? 'Failed to load AI status') : null,
  }
}

export function useAiConfig() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.aiConfig,
    queryFn: ({ signal }) => aiService.getConfig(signal),
  })
  return {
    config: data ?? null,
    isLoading: isPending,
    error: error ? (error.message ?? 'Failed to load AI configuration') : null,
  }
}

export function useAiTools() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.aiTools,
    queryFn: ({ signal }) => aiService.getTools(signal),
  })
  return {
    tools: data ?? null,
    isLoading: isPending,
    error: error ? (error.message ?? 'Failed to load tools') : null,
  }
}

export function useAiRouting() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.aiRouting,
    queryFn: ({ signal }) => aiService.getRouting(signal),
  })
  return {
    routing: data ?? null,
    isLoading: isPending,
    error: error ? (error.message ?? 'Failed to load agent routing') : null,
  }
}

export function useAiIntegrations() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: queryKeys.aiIntegrations,
    queryFn: ({ signal }) => aiService.listIntegrations(signal),
  })
  return {
    integrations: data?.items ?? [],
    isLoading: isPending,
    error: error ? (error.message ?? 'Failed to load integrations') : null,
    refetch,
  }
}
