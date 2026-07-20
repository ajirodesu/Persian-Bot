/**
 * Cat-Bot — Unified User Info Model
 *
 * Single source of truth for user representations across all platforms.
 * Every platform wrapper's getFullUserInfo() must produce this shape.
 *
 * Platform concept mapping:
 *   Discord      → User object fetched via client.users.fetch(); guild member overlay when available
 *   Telegram     → User from getChatMember / ctx.from; no standalone getUser endpoint in Bot API
 *
 * The `raw` field carries the native platform object untouched so command modules
 * that need platform-specific fields (Discord flags, Telegram premium_type, etc.)
 * can read from raw without breaking the unified contract.
 */
import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
/**
 * Frozen prototype documenting every key a consumer may safely read.
 * createUnifiedUserInfo() is the production factory; use that instead of
 * spreading this object to ensure new fields always get defaults.
 */
export const PROTO_UNIFIED_USER_INFO = Object.freeze({
    platform: 'unknown',
    id: '',
    name: '',
    firstName: null,
    username: null,
    avatarUrl: null,
});
/**
 * Creates a UnifiedUserInfo from partial data, filling in safe defaults for any
 * missing field. All platform wrapper getFullUserInfo() implementations must go
 * through this factory — never construct the shape inline, so that adding a new
 * field only requires one change here.
 */
export function createUnifiedUserInfo(data) {
    logger.debug('[user.model] createUnifiedUserInfo called', {
        platform: data.platform,
        id: data.id,
    });
    return {
        platform: data.platform ?? 'unknown',
        id: data.id ?? '',
        name: data.name ?? '',
        firstName: data.firstName ?? null,
        username: data.username ?? null,
        avatarUrl: data.avatarUrl ?? null,
    };
}
//# sourceMappingURL=user.model.js.map