/**
 * Admin DTOs — admin-only API type contracts
 *
 * Kept separate from bot.dto.ts because these types expose cross-user data
 * (listAll bots) and global configuration (system admins) that user-facing
 * endpoints must never return. Keeping them isolated enforces the boundary
 * at the type level rather than relying on runtime guards alone.
 */

// Admin bot listing — includes isRunning and userId which user-scoped list omits
export interface GetAdminBotListItemDto {
  sessionId: string;
  userId: string;
  platformId: number;
  platform: string;
  nickname: string;
  prefix: string;
  isRunning: boolean;
  // Optional — absent only when the owning user account no longer exists in the auth DB.
  userName?: string | undefined;
  userEmail?: string | undefined;
  // The bot's own platform identity, derived from stored session credentials
  // (never a live platform lookup, so listing stays a single DB round-trip):
  // Discord exposes its client (application) ID, Telegram embeds the numeric
  // bot ID in the token prefix. Usernames are not persisted anywhere, so
  // botUsername stays absent until identity is stored at connect time.
  // Absent for Fluxer (opaque token) and when credentials are missing.
  botId?: string | undefined;
  botUsername?: string | undefined;
}

export interface GetAdminBotListResponseDto {
  bots: GetAdminBotListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  stats: {
    totalBots: number;
    activeBots: number;
    platformDist: Record<string, number>;
    // Tracks active (isRunning=true) bots grouped by platform
    platformActiveDist: Record<string, number>;
  };
}

// System admin — global platform-native user IDs with highest authority
export interface SystemAdminItemDto {
  id: string;
  adminId: string;
  createdAt: string;
}

export interface GetSystemAdminsResponseDto {
  admins: SystemAdminItemDto[];
}

export interface AddSystemAdminRequestDto {
  adminId: string;
}

export interface AdminUserItemDto {
  id: string;
  name: string;
  email: string;
  role: string | null;
  createdAt: string;
  banned: boolean;
  emailVerified: boolean;
}

export interface GetAdminUserListResponseDto {
  users: AdminUserItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  stats: {
    totalUsers: number;
    adminCount: number;
    bannedCount: number;
  };
}

// Reset All Database — destructive, admin-only, requires exact phrase match server-side
// (not just client-side UI gating) so the endpoint can never be triggered by a bare
// POST with no body, e.g. from a replayed request or a scripted/curl call.
export const RESET_ALL_DATABASE_CONFIRMATION_PHRASE = 'RESET ALL DATA' as const;

export interface ResetAllDatabaseRequestDto {
  confirmationPhrase: string;
}

export interface ResetAllDatabaseResponseDto {
  status: 'reset';
  preservedAdminId: string;
}

// Maintenance Mode — global switch restricting bot usage to System Admins only
export interface GetMaintenanceModeResponseDto {
  enabled: boolean;
}

export interface UpdateMaintenanceModeRequestDto {
  enabled: boolean;
}
