import apiClient from '@/lib/api-client.lib'

export interface AiProviderState {
  baseUrl?: string
  models?: string[]
  apiKeyMasked: string | null
  configured: boolean
}

export interface AiAgentState {
  provider?: string
  model?: string
  models?: string[]
  temperature?: number
  maxTokens?: number
  json?: boolean
  timeout?: number
  fallback?: { provider: string; model: string; baseUrl?: string }[]
}

export interface AiConfigDto {
  enabled: boolean
  provider: string | null
  model: string | null
  models: string[]
  baseUrl: string | null
  apiKeyMasked: string | null
  apiKeyConfigured: boolean
  temperature: number
  maxTokens: number
  timeout: number
  maxRetries: number
  providers: Record<string, AiProviderState>
  agents: Record<string, AiAgentState>
  memory: { enabled: boolean; maxRecentTurns: number; retentionDays: number; summaryMaxChars?: number }
  execution: { maxSteps: number; timeoutMs: number; maxToolErrors: number; maxCallsPerStep: number }
  moderation: { enabled: boolean; minConfidence: number; secondOpinion: boolean; dryRun: boolean }
  autoReply: { mention: boolean; dm: boolean }
}

export interface AiStatusDto {
  enabled: boolean
  configured: boolean
  provider: string | null
  model: string | null
  candidates: string[]
  agents: number
  tools: { name: string; description: string; risk: number }[]
  providers: string[]
}

export interface AiTestResultDto {
  ok: boolean
  provider?: string
  model?: string
  latencyMs: number
  attempts?: number
  reply?: string
  error?: string
}

export interface AiIntegrationDto {
  id: string
  kind: 'mcp' | 'skill'
  name: string
  config: Record<string, unknown>
  risk: 0 | 1 | 2
  minRole: number
  status: 'active' | 'pending_review' | 'restricted' | 'disabled'
  dangerReasons: string[]
  approvedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface AiIntegrationSaveResponse {
  item: AiIntegrationDto | null
  autoRestricted: boolean
  reasons: string[]
}

export interface AiIntegrationTestResponse {
  ok: boolean
  detail: string
  tools?: string[]
  latencyMs: number
  autoRestricted: boolean
}

export interface AiToolsDto {
  builtIn: { name: string; description: string; risk: number; minRole: number; required: string[] }[]
  mcp: AiIntegrationDto[]
  skills: AiIntegrationDto[]
}

export interface AiSavePayload {
  enabled?: boolean
  provider?: string
  model?: string
  models?: string[]
  baseUrl?: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
  timeout?: number
  maxRetries?: number
  providers?: Record<string, { apiKey?: string; baseUrl?: string; models?: string[] }>
  agents?: Record<string, AiAgentState>
  memory?: AiConfigDto['memory']
  execution?: AiConfigDto['execution']
  moderation?: AiConfigDto['moderation']
  autoReply?: AiConfigDto['autoReply']
}

class AiService {
  async getStatus(signal?: AbortSignal): Promise<AiStatusDto> {
    const response = await apiClient.get<AiStatusDto>('/api/v1/ai/status', { signal })
    return response.data
  }

  async getConfig(signal?: AbortSignal): Promise<AiConfigDto> {
    const response = await apiClient.get<AiConfigDto>('/api/v1/ai/config', { signal })
    return response.data
  }

  async saveConfig(payload: AiSavePayload): Promise<AiConfigDto> {
    const response = await apiClient.put<AiConfigDto>('/api/v1/ai/config', payload)
    return response.data
  }

  async getTools(signal?: AbortSignal): Promise<AiToolsDto> {
    const response = await apiClient.get<AiToolsDto>('/api/v1/ai/tools', { signal })
    return response.data
  }

  async getRouting(signal?: AbortSignal): Promise<Record<string, { candidates: string[]; json: boolean; temperature: number }>> {
    const response = await apiClient.get<Record<string, { candidates: string[]; json: boolean; temperature: number }>>(
      '/api/v1/ai/routing',
      { signal },
    )
    return response.data
  }

  async getProviderModels(provider: string): Promise<{ provider: string; models: string[] }> {
    const response = await apiClient.get<{ provider: string; models: string[] }>(
      `/api/v1/ai/providers/${encodeURIComponent(provider)}/models`,
    )
    return response.data
  }

  async getAudit(limit = 20, signal?: AbortSignal): Promise<{ entries: unknown[] }> {
    const response = await apiClient.get<{ entries: unknown[] }>('/api/v1/ai/audit', {
      params: { limit },
      signal,
    })
    return response.data
  }

  async testConnection(agent = 'default'): Promise<AiTestResultDto> {
    const response = await apiClient.post<AiTestResultDto>('/api/v1/ai/test', { agent })
    return response.data
  }

  async listIntegrations(signal?: AbortSignal): Promise<{ items: AiIntegrationDto[] }> {
    const response = await apiClient.get<{ items: AiIntegrationDto[] }>(
      '/api/v1/ai/integrations',
      { signal },
    )
    return response.data
  }

  async createIntegration(payload: {
    kind: 'mcp' | 'skill'
    name: string
    config: Record<string, unknown>
  }): Promise<AiIntegrationSaveResponse> {
    const response = await apiClient.post<AiIntegrationSaveResponse>(
      '/api/v1/ai/integrations',
      payload,
    )
    return response.data
  }

  async updateIntegration(
    id: string,
    payload: { name?: string; config?: Record<string, unknown> },
  ): Promise<AiIntegrationSaveResponse> {
    const response = await apiClient.put<AiIntegrationSaveResponse>(
      `/api/v1/ai/integrations/${id}`,
      payload,
    )
    return response.data
  }

  async deleteIntegration(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/ai/integrations/${id}`)
  }

  async testIntegration(id: string): Promise<AiIntegrationTestResponse> {
    const response = await apiClient.post<AiIntegrationTestResponse>(
      `/api/v1/ai/integrations/${id}/test`,
    )
    return response.data
  }
}

export const aiService = new AiService()
