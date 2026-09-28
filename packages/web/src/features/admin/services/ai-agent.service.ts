import apiClient from '@/lib/api-client.lib'

// ── DTOs (mirror the server's masked shape — the secret is never exposed) ───

export type AiAgentConnectionStatus =
  | 'Connected'
  | 'Disconnected'
  | 'Unauthorized'
  | 'Service unavailable'
  | 'Endpoint not found'
  | 'Configuration incomplete'
  | 'Unsupported'
  | 'Disabled'

export type AiAgentAuthMode = 'none' | 'token'

export interface AiAgentCapabilitiesDto {
  toolCalling: boolean
  mcp: boolean
  skills: boolean
  mcpReason?: string
  skillsReason?: string
  model?: string
}

export interface AiAgentSettingsDto {
  enabled: boolean
  needleUrl: string
  /** Always masked — true when a token is stored, never the value. */
  tokenConfigured: boolean
  /** 'none' = unauthenticated service (normal) · 'token' = Service Token set. */
  authMode: AiAgentAuthMode
  timeoutMs: number
  confidenceThreshold: number
  updatedAt: string
  lastSuccessAt: string
}

export interface AiAgentTestDto {
  status: AiAgentConnectionStatus
  /** Precise reason — never collapsed, never a secret. */
  detail: string | null
  capabilities: AiAgentCapabilitiesDto | null
  /** Loaded model name from GET /model (only what the service returns). */
  model: string | null
  /** Inference endpoint used, e.g. /complete. */
  endpoint: string | null
  latencyMs: number | null
  lastCheckedAt: string
}

// ── Service ──────────────────────────────────────────────────────────────────

class AiAgentService {
  /** GET /api/v1/admin/ai-agent */
  async getSettings(): Promise<AiAgentSettingsDto> {
    const response = await apiClient.get<AiAgentSettingsDto>(
      '/api/v1/admin/ai-agent',
    )
    return response.data
  }

  /** PUT /api/v1/admin/ai-agent — omit token to keep the stored secret. */
  async updateSettings(data: {
    enabled: boolean
    needleUrl: string
    token?: string
    timeoutMs: number
    confidenceThreshold: number
  }): Promise<AiAgentSettingsDto> {
    const response = await apiClient.put<AiAgentSettingsDto>(
      '/api/v1/admin/ai-agent',
      data,
    )
    return response.data
  }

  /** POST /api/v1/admin/ai-agent/test — real authenticated probe. */
  async testConnection(): Promise<AiAgentTestDto> {
    const response = await apiClient.post<AiAgentTestDto>(
      '/api/v1/admin/ai-agent/test',
    )
    return response.data
  }

  /** GET /api/v1/admin/ai-agent/capabilities — live detection. */
  async getCapabilities(): Promise<AiAgentTestDto> {
    const response = await apiClient.get<AiAgentTestDto>(
      '/api/v1/admin/ai-agent/capabilities',
    )
    return response.data
  }
}

export const aiAgentService = new AiAgentService()
export default aiAgentService
