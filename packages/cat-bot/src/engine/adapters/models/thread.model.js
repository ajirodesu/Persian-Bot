/**
 * Cat-Bot — Unified Thread Info Model
 *
 * Single source of truth for thread / group / server representations across all platforms.
 * Every platform wrapper's getFullThreadInfo() must produce this shape.
 *
 * Platform concept mapping:
 *   Discord      → Enclosing Guild (server); threadID is the channel ID used to locate it.
 *                  raw.guild contains the full server model including channels and cached members.
 *   Telegram     → Chat object (group, supergroup, channel, or private DM).
 *                  adminIDs populated via getChatAdministrators for group/supergroup types.
 *
 * The `raw` field carries the native platform object untouched so command modules
 * that need platform-specific data (Discord roles/emojis, Telegram pinned_message, etc.)
 * can access it without breaking the unified contract.
 */
import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
/**
 * Frozen prototype documenting every key a consumer may safely read.
 * Useful for tests and as a reference shape — createUnifiedThreadInfo() is the
 * production factory and should be used instead of spreading this object.
 */
export const PROTO_UNIFIED_THREAD_INFO = Object.freeze({
    platform: 'unknown',
    threadID: '',
    name: null,
    isGroup: false,
    memberCount: null,
    participantIDs: [],
    adminIDs: [],
    avatarUrl: null,
    serverID: null,
});
/**
 * Creates a UnifiedThreadInfo from partial data, filling in safe defaults for any
 * missing field. All platform wrapper getFullThreadInfo() implementations must go
 * through this factory — never construct the shape inline, so that adding a new
 * field only requires one change here.
 */
export function createUnifiedThreadInfo(data) {
    logger.debug('[thread.model] createUnifiedThreadInfo called', {
        platform: data.platform,
        threadID: data.threadID,
    });
    return {
        platform: data.platform ?? 'unknown',
        threadID: data.threadID ?? '',
        name: data.name ?? null,
        isGroup: data.isGroup ?? false,
        memberCount: data.memberCount ?? null,
        participantIDs: data.participantIDs ?? [],
        adminIDs: data.adminIDs ?? [],
        avatarUrl: data.avatarUrl ?? null,
        serverID: data.serverID ?? null,
    };
}
//# sourceMappingURL=thread.model.js.map