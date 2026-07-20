/**
 * BotThread Model — Type definitions and mapper for persistent thread records.
 *
 * Bridges UnifiedThreadInfo (produced by ctx.thread.getInfo()) and the flat data
 * shape the repository layer accepts for multi-model upserting.
 */
// Convert the platform string to its numeric DB ID at the model boundary
import { toPlatformNumericId } from '@/engine/modules/platform/platform-id.util.js';
// ── Mapper ────────────────────────────────────────────────────────────────────
/**
 * Maps a UnifiedThreadInfo to BotThreadData.
 *
 * UnifiedThreadInfo uses `threadID`; BotThread uses `threadId` (camelCase
 * consistency convention for non-ID fields).
 */
export function toBotThreadData(info) {
    return {
        platformId: toPlatformNumericId(info.platform),
        // Map UnifiedThreadInfo.threadID to the generic 'id' PK
        id: info.threadID,
        name: info.name ?? null,
        isGroup: info.isGroup,
        memberCount: info.memberCount ?? null,
        participantIDs: info.participantIDs,
        adminIDs: info.adminIDs,
        avatarUrl: info.avatarUrl ?? null,
    };
}
//# sourceMappingURL=threads.model.js.map