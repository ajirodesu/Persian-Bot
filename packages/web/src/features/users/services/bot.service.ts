import apiClient from '@/lib/api-client.lib'
import type {
  CreateBotRequestDto,
  CreateBotResponseDto,
  GetBotListResponseDto,
  GetBotDetailResponseDto,
  UpdateBotRequestDto,
  GetBotCommandsResponseDto,
  GetBotEventsResponseDto,
} from '@/features/users/dtos/bot.dto'

// ── Database panel DTOs ────────────────────────────────────────────────────

export interface BotDatabaseUser {
  id: string
  name: string
  first_name: string | null
  username: string | null
  avatar_url: string | null
  last_seen: string | null
  is_banned: boolean
  ban_reason: string | null
}

export interface BotDatabaseGroup {
  id: string
  name: string
  is_group: boolean
  member_count: number | null
  avatar_url: string | null
  last_seen: string | null
  is_banned: boolean
  ban_reason: string | null
}

export interface BotDatabaseUsersResponseDto {
  users: BotDatabaseUser[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface BotDatabaseGroupsResponseDto {
  groups: BotDatabaseGroup[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export type BotDatabaseStatusFilter = 'all' | 'active' | 'banned'
export type BotDatabaseSortBy = 'name' | 'last_seen'
export type BotDatabaseSortDir = 'asc' | 'desc'

export interface BotDatabaseQueryOptions {
  status?: BotDatabaseStatusFilter
  sortBy?: BotDatabaseSortBy
  sortDir?: BotDatabaseSortDir
}

export class BotService {
  async createBot(dto: CreateBotRequestDto): Promise<CreateBotResponseDto> {
    // Vite's dev proxy (vite.config.ts server.proxy) forwards /api/* to Express at
    // localhost:3000 — no explicit baseURL needed. Production deploys behind the same
    // origin reverse proxy so same-origin behaviour holds without extra config.
    const response = await apiClient.post<CreateBotResponseDto>(
      '/api/v1/bots',
      dto,
    )
    return response.data
  }

  async getBot(id: string): Promise<GetBotDetailResponseDto> {
    const response = await apiClient.get<GetBotDetailResponseDto>(
      `/api/v1/bots/${id}`,
    )
    return response.data
  }

  async updateBot(
    id: string,
    dto: UpdateBotRequestDto,
  ): Promise<GetBotDetailResponseDto> {
    const response = await apiClient.put<GetBotDetailResponseDto>(
      `/api/v1/bots/${id}`,
      dto,
    )
    return response.data
  }

  // Auth is cookie-based (credentials: 'include' set in ApiClient), so no
  // explicit token header is needed — the session cookie travels automatically.
  async listBots(): Promise<GetBotListResponseDto> {
    const response = await apiClient.get<GetBotListResponseDto>('/api/v1/bots')
    return response.data
  }

  // Commands toggle — reads and mutates bot_session_commands rows for this session
  async getCommands(
    sessionId: string,
    page = 1,
    limit = 12,
    search = '',
  ): Promise<GetBotCommandsResponseDto> {
    const response = await apiClient.get<GetBotCommandsResponseDto>(
      `/api/v1/bots/${sessionId}/commands`,
      { params: { page, limit, search } },
    )
    return response.data
  }

  async toggleCommand(
    sessionId: string,
    commandName: string,
    isEnable: boolean,
  ): Promise<void> {
    await apiClient.put(`/api/v1/bots/${sessionId}/commands/${commandName}`, {
      isEnable,
    })
  }

  // Toggles a command's membership in the session-wide admin-only ignore list —
  // identical effect to running `/ignoreonlyad add|del <commandName>`.
  async toggleCommandIgnoreAdminOnly(
    sessionId: string,
    commandName: string,
    ignored: boolean,
  ): Promise<void> {
    await apiClient.put(
      `/api/v1/bots/${sessionId}/commands/${commandName}/ignore-admin-only`,
      { ignored },
    )
  }

  // Session-wide "Bot Admin Only" switch — identical logic/effect to `/adminonly on|off`.
  async getAdminOnly(sessionId: string): Promise<{ enabled: boolean }> {
    const response = await apiClient.get<{ enabled: boolean }>(
      `/api/v1/bots/${sessionId}/admin-only`,
    )
    return response.data
  }

  async setAdminOnly(
    sessionId: string,
    enabled: boolean,
  ): Promise<{ enabled: boolean }> {
    const response = await apiClient.put<{ enabled: boolean }>(
      `/api/v1/bots/${sessionId}/admin-only`,
      { enabled },
    )
    return response.data
  }

  // Events toggle — reads and mutates bot_session_events rows for this session
  async getEvents(
    sessionId: string,
    page = 1,
    limit = 12,
    search = '',
  ): Promise<GetBotEventsResponseDto> {
    const response = await apiClient.get<GetBotEventsResponseDto>(
      `/api/v1/bots/${sessionId}/events`,
      { params: { page, limit, search } },
    )
    return response.data
  }

  async toggleEvent(
    sessionId: string,
    eventName: string,
    isEnable: boolean,
  ): Promise<void> {
    await apiClient.put(`/api/v1/bots/${sessionId}/events/${eventName}`, {
      isEnable,
    })
  }

  async startBot(id: string): Promise<void> {
    await apiClient.post(`/api/v1/bots/${id}/start`)
  }

  async stopBot(id: string): Promise<void> {
    await apiClient.post(`/api/v1/bots/${id}/stop`)
  }

  async restartBot(id: string): Promise<void> {
    await apiClient.post(`/api/v1/bots/${id}/restart`)
  }

  // Fetches the in-memory ANSI log history for this session via HTTP.
  // Returns at most 100 buffered entries (log-relay's MAX_HISTORY sliding window).
  // History resets on process restart — the endpoint returns [] on a cold start.
  async getLogs(sessionId: string): Promise<{ entries: string[] }> {
    const response = await apiClient.get<{ entries: string[] }>(
      `/api/v1/bots/${sessionId}/logs`,
    )
    return response.data
  }

  // Permanently deletes the bot session and all its associated data server-side.
  async deleteBot(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/bots/${id}`)
  }

  // ── Database panel ────────────────────────────────────────────────────────

  async getDatabaseUsers(
    sessionId: string,
    page = 1,
    limit = 20,
    search = '',
    options: BotDatabaseQueryOptions = {},
  ): Promise<BotDatabaseUsersResponseDto> {
    const response = await apiClient.get<BotDatabaseUsersResponseDto>(
      `/api/v1/bots/${sessionId}/database/users`,
      {
        params: {
          page,
          limit,
          search,
          status: options.status ?? 'all',
          sortBy: options.sortBy ?? 'last_seen',
          sortDir: options.sortDir ?? 'desc',
        },
      },
    )
    return response.data
  }

  async getDatabaseGroups(
    sessionId: string,
    page = 1,
    limit = 20,
    search = '',
    options: BotDatabaseQueryOptions = {},
  ): Promise<BotDatabaseGroupsResponseDto> {
    const response = await apiClient.get<BotDatabaseGroupsResponseDto>(
      `/api/v1/bots/${sessionId}/database/groups`,
      {
        params: {
          page,
          limit,
          search,
          status: options.status ?? 'all',
          sortBy: options.sortBy ?? 'last_seen',
          sortDir: options.sortDir ?? 'desc',
        },
      },
    )
    return response.data
  }

  async deleteDatabaseUser(sessionId: string, userId: string): Promise<void> {
    await apiClient.delete(`/api/v1/bots/${sessionId}/database/users/${userId}`)
  }

  async banDatabaseUser(sessionId: string, userId: string, reason?: string): Promise<void> {
    await apiClient.post(`/api/v1/bots/${sessionId}/database/users/${userId}/ban`, { reason })
  }

  async unbanDatabaseUser(sessionId: string, userId: string): Promise<void> {
    await apiClient.delete(`/api/v1/bots/${sessionId}/database/users/${userId}/ban`)
  }

  async deleteDatabaseGroup(sessionId: string, groupId: string): Promise<void> {
    await apiClient.delete(`/api/v1/bots/${sessionId}/database/groups/${groupId}`)
  }

  async banDatabaseGroup(sessionId: string, groupId: string, reason?: string): Promise<void> {
    await apiClient.post(`/api/v1/bots/${sessionId}/database/groups/${groupId}/ban`, { reason })
  }

  async unbanDatabaseGroup(sessionId: string, groupId: string): Promise<void> {
    await apiClient.delete(`/api/v1/bots/${sessionId}/database/groups/${groupId}/ban`)
  }
}

export const botService = new BotService()
