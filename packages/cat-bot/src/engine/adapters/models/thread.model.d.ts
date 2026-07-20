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
export type PlatformId = string;
/**
 * Unified shape for thread / group / server metadata across all platforms.
 * Platform wrappers return this from getFullThreadInfo(); command modules
 * read only these fields so they remain platform-agnostic.
 */
export interface UnifiedThreadInfo {
    /** Source platform identifier — matches platform wrappers' this.platform value. */
    platform: PlatformId;
    /** Platform-specific thread / chat / channel ID (always a string). */
    threadID: string;
    /** Display name of the group; null for unnamed threads or DMs. */
    name: string | null;
    /** True when there are more than 2 participants. */
    isGroup: boolean;
    /** Approximate total member count; null if the platform does not expose it. */
    memberCount: number | null;
    /** Known participant IDs; may be partial for large guilds (Discord cache limit). */
    participantIDs: string[];
    /** Admin / moderator user IDs; may be partial or empty depending on platform. */
    adminIDs: string[];
    /** Group icon URL; null if not set or inaccessible. */
    avatarUrl: string | null;
    /** Discord server ID. Null for DMs or non-Discord platforms. */
    serverID?: string | null;
}
/**
 * Frozen prototype documenting every key a consumer may safely read.
 * Useful for tests and as a reference shape — createUnifiedThreadInfo() is the
 * production factory and should be used instead of spreading this object.
 */
export declare const PROTO_UNIFIED_THREAD_INFO: Readonly<UnifiedThreadInfo>;
/**
 * Creates a UnifiedThreadInfo from partial data, filling in safe defaults for any
 * missing field. All platform wrapper getFullThreadInfo() implementations must go
 * through this factory — never construct the shape inline, so that adding a new
 * field only requires one change here.
 */
export declare function createUnifiedThreadInfo(data: Partial<UnifiedThreadInfo>): UnifiedThreadInfo;
//# sourceMappingURL=thread.model.d.ts.map