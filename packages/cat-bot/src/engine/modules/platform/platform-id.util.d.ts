/**
 * Platform ID Conversion Utilities
 *
 * Pure conversion layer between the human-readable platform string used throughout
 * the runtime (ctx.native.platform, UnifiedApi.platform) and the compact integer
 * stored in the database (bot_users.platform, bot_threads.platform).
 *
 * Conversion happens exactly once, at the model boundary (toBotThreadData /
 * toBotUserData).  No other layer ever reads or writes raw platform integers.
 */
/**
 * Converts a runtime platform string to its assigned database integer.
 *
 * Throws immediately on an unrecognised platform so callers surface the bug
 * at write-time rather than storing a silent zero or wrong ID.
 */
export declare function toPlatformNumericId(platform: string): number;
/**
 * Converts a stored numeric platform ID back to its runtime string.
 *
 * Used when reading rows from bot_users / bot_threads and the calling code
 * needs the human-readable platform name for API calls or logging.
 */
export declare function fromPlatformNumericId(id: number): string;
//# sourceMappingURL=platform-id.util.d.ts.map