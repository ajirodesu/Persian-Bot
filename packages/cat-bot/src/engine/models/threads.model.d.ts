/**
 * BotThread Model — Type definitions and mapper for persistent thread records.
 *
 * Bridges UnifiedThreadInfo (produced by ctx.thread.getInfo()) and the flat data
 * shape the repository layer accepts for multi-model upserting.
 */
import type { UnifiedThreadInfo } from '@/engine/adapters/models/thread.model.js';
/**
 * Data shape accepted by upsertThread().
 * participantIDs and adminIDs are mapped internally to many-to-many connections.
 */
export interface BotThreadData {
    /** Platform identifier — e.g. 'discord', 'telegram'. */
    platformId: number;
    /** Platform-specific thread / channel / group ID (always a string). Renamed to 'id' for DB consistency. */
    id: string;
    /** Display name of the group; null for unnamed threads or DMs. */
    name: string | null;
    /** True when there are more than 2 participants. */
    isGroup: boolean;
    /** Approximate member count; null when the platform does not expose it. */
    memberCount: number | null;
    /** Array of known participant user IDs to be connected via relation table. */
    participantIDs: string[];
    /** Array of admin / moderator user IDs to be connected via relation table. */
    adminIDs: string[];
    /** Group icon URL; null when not set or inaccessible. */
    avatarUrl: string | null;
}
/**
 * Maps a UnifiedThreadInfo to BotThreadData.
 *
 * UnifiedThreadInfo uses `threadID`; BotThread uses `threadId` (camelCase
 * consistency convention for non-ID fields).
 */
export declare function toBotThreadData(info: UnifiedThreadInfo): BotThreadData;
//# sourceMappingURL=threads.model.d.ts.map