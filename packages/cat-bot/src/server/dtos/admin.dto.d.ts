/**
 * Admin DTOs — admin-only API type contracts
 *
 * Kept separate from bot.dto.ts because these types expose cross-user data
 * (listAll bots) and global configuration (system admins) that user-facing
 * endpoints must never return. Keeping them isolated enforces the boundary
 * at the type level rather than relying on runtime guards alone.
 */
export interface GetAdminBotListItemDto {
    sessionId: string;
    userId: string;
    platformId: number;
    platform: string;
    nickname: string;
    prefix: string;
    isRunning: boolean;
    userName?: string;
    userEmail?: string;
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
        platformActiveDist: Record<string, number>;
    };
}
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
//# sourceMappingURL=admin.dto.d.ts.map