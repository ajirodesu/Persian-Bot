import apiClient from '@/lib/api-client.lib'

// ── Response types ─────────────────────────────────────────────────────────────

export interface AdminMcpServerDto {
  id: string
  name: string
  url: string
  enabled: boolean
  /** Minimum role required to use this server's tools (0 anyone … 4 system admin). */
  role: number
  /** Only the header KEY names are exposed — values are encrypted at rest and never sent to the client. */
  headerKeys: string[]
  createdAt: string
  updatedAt: string
}

export interface GetMcpServersResponseDto {
  servers: AdminMcpServerDto[]
}

/** Sentinel id of the always-on built-in in-process agent MCP server. */
export const BUILTIN_MCP_SERVER_ID = 'builtin-cat-bot-agent'

/** True when the entry is the built-in server (visible, but not deletable). */
export function isBuiltinMcpServer(server: Pick<AdminMcpServerDto, 'id'>) {
  return server.id === BUILTIN_MCP_SERVER_ID
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
  /** Minimum role required to use this server's tools (0-4). */
  role?: number
  /**
   * Optional request headers (e.g. { Authorization: 'Bearer …' }) — encrypted
   * at rest. On update an empty-string value preserves the stored secret for
   * that key, and a previously-set key omitted from the map is deleted.
   */
  headers?: Record<string, string>
}

/** Role gate levels — mirrors the backend Role constants (role.constants.ts). */
export const MCP_ROLE_OPTIONS = [
  { value: 0, label: 'Anyone' },
  { value: 1, label: 'Group Admin' },
  { value: 2, label: 'Premium' },
  { value: 3, label: 'Bot Admin' },
  { value: 4, label: 'System Admin' },
] as const

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

  // POST /api/v1/admin/mcp-servers/test — one-shot connectivity + tool probe.
  // Pass `id` to test a saved server WITH its stored auth headers (header
  // values are encrypted at rest and never sent to this client, so the server
  // must attach them itself). `url` (+ optional `headers`) probes ad-hoc.
  async testServer(input: {
    id?: string
    url?: string
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