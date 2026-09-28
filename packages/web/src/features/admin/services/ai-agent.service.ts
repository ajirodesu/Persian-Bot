import apiClient from '@/lib/api-client.lib'

// ── DTOs (mirror the server's masked shape — the secret is never exposed) ───

export type AiAgentConnectionStatus =
  | 'Connected'
  | 'Disconnected'
  | 'Unauthorized'
  | 'Unavailable'
  | 'Configuration incomplete'
  | 'Unsupported'
  | 'Disabled'

export interface AiAgentCapabilitiesDto {
  toolCalling: boolean
  mcp: boolean
  skills: boolean
  mcpReason?: string
  skillsReason?: string
  generation?: number
  needleVersion?: string
  runtimeAvailable?: boolean
}

export interface AiAgentSettingsDto {
  enabled: boolean
  needleUrl: string
  /** Always masked — true when a token is stored, never the value. */
  tokenConfigured: boolean
  timeoutMs: number
  confidenceThreshold: number
  updatedAt: string
  lastSuccessAt: string
}

export interface AiAgentTestDto {
  status: AiAgentConnectionStatus
  capabilities: AiAgentCapabilitiesDto | null
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
