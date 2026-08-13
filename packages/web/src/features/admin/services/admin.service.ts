import apiClient from '@/lib/api-client.lib'

// ── Response types ─────────────────────────────────────────────────────────────

export interface AdminBotItemDto {
  sessionId: string
  userId: string
  platformId: number
  platform: string
  nickname: string
  prefix: string
  isRunning: boolean
  userName?: string
  userEmail?: string
}

export interface GetAdminBotsResponseDto {
  bots: AdminBotItemDto[]
  total: number
  page: number
  limit: number
  totalPages: number
  stats: {
    totalBots: number
    activeBots: number
    platformDist: Record<string, number>
    platformActiveDist: Record<string, number>
  }
}

export interface AdminUserItemDto {
  id: string
  name: string
  email: string
  role: string | null
  createdAt: string
  banned: boolean
  emailVerified: boolean
}

export interface SystemAdminDto {
  id: string
  adminId: string
  createdAt: string
}

export interface GetAdminUserListResponseDto {
  users: AdminUserItemDto[]
  total: number
  page: number
  limit: number
  totalPages: number
  stats: {
    totalUsers: number
    adminCount: number
    bannedCount: number
  }
}

export interface GetSystemAdminsResponseDto {
  admins: SystemAdminDto[]
}

// Must exactly match RESET_ALL_DATABASE_CONFIRMATION_PHRASE on the server —
// duplicated here (rather than imported) since the web package cannot import
// from the cat-bot server package. The server independently re-verifies this
// phrase, so a stale/mismatched client-side copy only fails closed, never open.
export const RESET_ALL_DATABASE_CONFIRMATION_PHRASE = 'RESET ALL DATA'

export interface ResetAllDatabaseResponseDto {
  status: 'reset'
  preservedAdminId: string
}

export interface GetMaintenanceModeResponseDto {
  enabled: boolean
}

// ── Service class ──────────────────────────────────────────────────────────────

class AdminService {
  // GET /api/v1/admin/bots — all bot sessions across all owners
  async getAdminBots(
    page = 1,
    limit = 10,
    search = '',
  ): Promise<GetAdminBotsResponseDto> {
    const response = await apiClient.get<GetAdminBotsResponseDto>(
      '/api/v1/admin/bots',
      {
        params: { page, limit, search },
      },
    )
    return response.data
  }

  async getAdminUsers(
    page = 1,
    limit = 10,
    search = '',
  ): Promise<GetAdminUserListResponseDto> {
    const response = await apiClient.get<GetAdminUserListResponseDto>(
      '/api/v1/admin/users',
      {
        params: { page, limit, search },
      },
    )
    return response.data
  }

  async getSystemAdmins(): Promise<GetSystemAdminsResponseDto> {
    const response = await apiClient.get<GetSystemAdminsResponseDto>(
      '/api/v1/admin/system-admins',
    )
    return response.data
  }

  async addSystemAdmin(adminId: string): Promise<SystemAdminDto> {
    const response = await apiClient.post<SystemAdminDto>(
      '/api/v1/admin/system-admins',
      { adminId },
    )
    return response.data
  }

  async removeSystemAdmin(adminId: string): Promise<void> {
    await apiClient.delete(
      `/api/v1/admin/system-admins/${encodeURIComponent(adminId)}`,
    )
  }

  // GET /api/v1/admin/maintenance-mode — global Maintenance Mode switch state
  async getMaintenanceMode(): Promise<GetMaintenanceModeResponseDto> {
    const response = await apiClient.get<GetMaintenanceModeResponseDto>(
      '/api/v1/admin/maintenance-mode',
    )
    return response.data
  }

  // PUT /api/v1/admin/maintenance-mode — toggle global Maintenance Mode (restrict bots to System Admins)
  async updateMaintenanceMode(enabled: boolean): Promise<GetMaintenanceModeResponseDto> {
    const response = await apiClient.put<GetMaintenanceModeResponseDto>(
      '/api/v1/admin/maintenance-mode',
      { enabled },
    )
    return response.data
  }

  /** Stops all bot sessions for a banned user — call fire-and-forget after better-auth banUser succeeds. */
  async stopUserSessions(userId: string): Promise<void> {
    await apiClient.post(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/ban-sessions`,
    )
  }

  /** Restarts all bot sessions for an unbanned user — call fire-and-forget after better-auth unbanUser succeeds. */
  async startUserSessions(userId: string): Promise<void> {
    await apiClient.post(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/unban-sessions`,
    )
  }

  async updateUser(
    userId: string,
    data: { name: string; email: string; role: string },
  ): Promise<void> {
    await apiClient.put(
      `/api/v1/admin/users/${encodeURIComponent(userId)}`,
      data,
    )
  }

  async verifyUser(userId: string): Promise<void> {
    await apiClient.post(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/verify`,
    )
  }

  async deleteUser(userId: string): Promise<void> {
    await apiClient.delete(
      `/api/v1/admin/users/${encodeURIComponent(userId)}`,
    )
  }

  // Admin-scope delete — composite key (userId + sessionId) lets the admin target any
  // user's session without needing that user's auth cookie. Mirrors user-facing deleteBot.
  async deleteBot(userId: string, sessionId: string): Promise<void> {
    await apiClient.delete(
      `/api/v1/admin/bots/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`,
    )
  }

  /**
   * Permanently wipes all database records and system data except the executing
   * admin's own account and associated data. The server independently re-verifies
   * confirmationPhrase against RESET_ALL_DATABASE_CONFIRMATION_PHRASE — this is a
   * defense-in-depth check, not a substitute for that server-side guard.
   */
  async resetAllDatabase(
    confirmationPhrase: string,
  ): Promise<ResetAllDatabaseResponseDto> {
    const response = await apiClient.post<ResetAllDatabaseResponseDto>(
      '/api/v1/admin/reset-database',
      { confirmationPhrase },
    )
    return response.data
  }
}

export const adminService = new AdminService()
export default adminService
