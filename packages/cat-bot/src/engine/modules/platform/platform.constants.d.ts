/**
 * Platform Numeric ID Registry
 *
 * Maps each runtime platform string identifier to a compact integer persisted in
 * bot_users.platform and bot_threads.platform.  Storing Int (4 bytes) instead of
 * VARCHAR cuts per-row overhead ~75% on those two high-volume tables.
 *
 * ── PERMANENT CONTRACT ─────────────────────────────────────────────────────────
 * Never change an existing number.  All historical rows carry the integer and
 * there is no automatic migration.  Only ever APPEND new entries at the bottom.
 *
 * Mapping:
 *   1  discord
 *   2  telegram
 *   3  webchat
 */
export declare const Platforms: {
    readonly Discord: "discord";
    readonly Telegram: "telegram";
    readonly Webchat: "webchat";
};
export declare const PLATFORM_TO_ID: {
    readonly discord: 1;
    readonly telegram: 2;
    readonly webchat: 3;
};
export declare const ID_TO_PLATFORM: {
    readonly 1: "discord";
    readonly 2: "telegram";
    readonly 3: "webchat";
};
/** Union of all recognised platform name strings. */
export type PlatformName = keyof typeof PLATFORM_TO_ID;
/** Union of all assigned numeric platform IDs. */
export type PlatformNumericId = (typeof PLATFORM_TO_ID)[PlatformName];
//# sourceMappingURL=platform.constants.d.ts.map