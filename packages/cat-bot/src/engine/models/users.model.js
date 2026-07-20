/**
 * BotUser Model — Type definitions and mapper for persistent user records.
 *
 * Bridges UnifiedUserInfo (produced by ctx.user.getInfo()) and the flat data
 * shape the repository layer accepts. Keeping the mapper here means:
 *   - Repo files never import from adapters/ (clean dependency direction)
 *   - Field renames (e.g. UnifiedUserInfo.id → BotUser.userId) live in one place
 */
// Convert the platform string to its numeric DB ID at the model boundary
import { toPlatformNumericId } from '@/engine/modules/platform/platform-id.util.js';
// ── Mapper ────────────────────────────────────────────────────────────────────
/**
 * Maps a UnifiedUserInfo object to the BotUserData shape the repository accepts.
 *
 * UnifiedUserInfo uses `id` for the platform user ID; BotUser uses `userId` so
 * the auto-increment primary key can remain a plain `id` without ambiguity.
 */
export function toBotUserData(info) {
    return {
        platformId: toPlatformNumericId(info.platform),
        // UnifiedUserInfo uses id; BotUserData also uses id as the primary key
        id: info.id,
        name: info.name,
        firstName: info.firstName ?? null,
        username: info.username ?? null,
        avatarUrl: info.avatarUrl ?? null,
    };
}
//# sourceMappingURL=users.model.js.map