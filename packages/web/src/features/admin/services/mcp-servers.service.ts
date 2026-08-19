import apiClient from '@/lib/api-client.lib'

// ── Response types ─────────────────────────────────────────────────────────────

export interface AdminMcpServerDto {
  id: string
  name: string
  url: string
  enabled: boolean
  /** Only the header KEY names are exposed — values are encrypted at rest and never sent to the client. */
  headerKeys: string[]
  createdAt: string
  updatedAt: string
}

export interface GetMcpServersResponseDto {
  servers: AdminMcpServerDto[]
}

export interface TestMcpServerResponseDto {
  ok: boolean
  toolCount: number
  toolNames: string[]
  error?: string
}

/** Body accepted when adding/updating a server. */
export interface McpServerInput {
  name: string
  url: string
  enabled?: boolean
  /** Optional request headers (e.g. { Authorization: 'Bearer …' }) — encrypted at rest. */
  headers?: Record<string, string>
}

// ── Service class ──────────────────────────────────────────────────────────────

class McpServersService {
  // GET /api/v1/admin/mcp-servers
  async listServers(): Promise<GetMcpServersResponseDto> {
    const response = await apiClient.get<GetMcpServersResponseDto>(
      '/api/v1/admin/mcp-servers',
    )
    return response.data
  }

  // POST /api/v1/admin/mcp-servers
  async createServer(input: McpServerInput): Promise<AdminMcpServerDto> {
    const response = await apiClient.post<{ server: AdminMcpServerDto }>(
      '/api/v1/admin/mcp-servers',
      input,
    )
    return response.data.server
  }

  // PUT /api/v1/admin/mcp-servers/:id
  async updateServer(
    id: string,
    input: Partial<McpServerInput>,
  ): Promise<AdminMcpServerDto> {
    const response = await apiClient.put<{ server: AdminMcpServerDto }>(
      `/api/v1/admin/mcp-servers/${encodeURIComponent(id)}`,
      input,
    )
    return response.data.server
  }

  // DELETE /api/v1/admin/mcp-servers/:id
  async removeServer(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/admin/mcp-servers/${encodeURIComponent(id)}`)
  }

  // POST /api/v1/admin/mcp-servers/test — one-shot connectivity + tool probe
  async testServer(input: {
    url: string
    headers?: Record<string, string>
  }): Promise<TestMcpServerResponseDto> {
    const response = await apiClient.post<TestMcpServerResponseDto>(
      '/api/v1/admin/mcp-servers/test',
      input,
    )
    return response.data
  }
}

export const mcpServersService = new McpServersService()
export default mcpServersService