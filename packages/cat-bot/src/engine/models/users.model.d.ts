/**
 * BotUser Model — Type definitions and mapper for persistent user records.
 *
 * Bridges UnifiedUserInfo (produced by ctx.user.getInfo()) and the flat data
 * shape the repository layer accepts. Keeping the mapper here means:
 *   - Repo files never import from adapters/ (clean dependency direction)
 *   - Field renames (e.g. UnifiedUserInfo.id → BotUser.userId) live in one place
 */
import type { UnifiedUserInfo } from '@/engine/adapters/models/user.model.js';
/**
 * Flat data shape accepted by upsertUser().
 * Mirrors the BotUser model's non-auto fields so the repo can pass it
 * directly to the upsert call without knowing UnifiedUserInfo's field names.
 */
export interface BotUserData {
    /** Platform identifier — e.g. 'discord', 'telegram'. */
    platformId: number;
    /** Platform-specific user ID (always a string for cross-platform consistency). Renamed to 'id' for DB consistency. */
    id: string;
    /** Best available display name — never empty; platform wrappers guarantee this. */
    name: string;
    /** First name if the platform surfaces it separately; null otherwise. */
    firstName: string | null;
    /** Handle / vanity slug without @ prefix; null if unavailable. */
    username: string | null;
    /** Profile picture URL; null if unavailable or requires authentication. */
    avatarUrl: string | null;
}
/**
 * Maps a UnifiedUserInfo object to the BotUserData shape the repository accepts.
 *
 * UnifiedUserInfo uses `id` for the platform user ID; BotUser uses `userId` so
 * the auto-increment primary key can remain a plain `id` without ambiguity.
 */
export declare function toBotUserData(info: UnifiedUserInfo): BotUserData;
//# sourceMappingURL=users.model.d.ts.map