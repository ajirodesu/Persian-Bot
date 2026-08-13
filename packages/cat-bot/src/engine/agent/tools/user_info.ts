/**
 * get_user Tool — Live User Lookup (Mention-Aware)
 *
 * Converted from project-canis (src/components/ai/tools/userInfo.ts) and
 * extended for the Cat-Bot context. Resolves a user's profile with live data
 * from the platform SDK (via ctx.user.getInfo → getFullUserInfo), falling back
 * to the stored database profile when the live fetch is unavailable.
 *
 * Target resolution priority:
 *   1. `username` (with or without @) → case-insensitive lookup scoped to the
 *      current platform
 *   2. `uid` (platform user ID)
 *   3. The user(s) MENTIONED in the triggering message (ctx.event.mentions) —
 *      so asking about @someone returns THAT person's info, never the
 *      requester's. The bot's own mention is excluded, and with multiple
 *      mentions the first non-bot one wins.
 *   4. The sender of the current message (only when nothing else identifies
 *      a user — e.g. "who am I?")
 *
 * Profile data: live platform info preferred (name / username / first name /
 * avatar), stored DB fields fill in gaps (e.g. Telegram's live avatar is
 * always null). The result reports `source: 'live' | 'stored'` and how the
 * target was resolved (`lookupBy`). Never throws — every failure returns a
 * descriptive string.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { resolveAgentContext } from '../agent.util.js';
import { getUserById, getUserByUsername } from '@/engine/repos/users.repo.js';
import type { StoredUserProfile } from '@/engine/models/users.model.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'get_user',
  description:
    'Look up a user and get their actual profile information. ' +
    "Pass `username` (e.g. '@alice') or `uid` (the numeric platform ID) to look " +
    'up that specific person. When neither is passed, the user MENTIONED in the ' +
    'current message is looked up automatically (never the requester), and only ' +
    'as a last resort the sender of the message. Returns name, username, first ' +
    'name and avatar URL from live platform data.',
  parameters: {
    type: 'object',
    properties: {
      uid: {
        // ['string', 'null'] — models frequently pass null for skipped optional
        // args; Groq rejects a bare type: 'string' server-side (400
        // tool_use_failed) when the value is null.
        type: ['string', 'null'],
        description:
          "The user's platform ID, e.g. '123456789' (no @ or suffix).",
      },
      username: {
        type: ['string', 'null'],
        description:
          "The user's username, e.g. '@alice' or 'alice' (case-insensitive).",
      },
    },
    required: [],
  },
};

// ============================================================================
// PROFILE RESOLUTION
// ============================================================================

/**
 * Fetches the profile with the highest accuracy available: live platform data
 * first (ctx.user.getInfo → the platform SDK), falling back to the stored DB
 * profile, then merging so live fields win and stored fields fill the gaps
 * (Telegram's live avatarUrl is always null, for example).
 */
async function resolveProfile(
  uid: string,
  ctx: AppCtx,
  platform: string,
): Promise<{
  profile: StoredUserProfile | null;
  source: 'live' | 'stored' | 'none';
}> {
  let live: StoredUserProfile | null = null;
  if (ctx.user && typeof ctx.user.getInfo === 'function') {
    try {
      const info = await ctx.user.getInfo(uid);
      // A "real" result has an actual name — platform wrappers return a
      // `User {id}` stub when they cannot resolve the user.
      if (info && info.name && info.name !== `User ${uid}`) {
        live = {
          id: info.id,
          name: info.name,
          firstName: info.firstName ?? null,
          username: info.username ?? null,
          avatarUrl: info.avatarUrl ?? null,
        };
      }
    } catch {
      // Live lookup failed — fall through to the stored profile
    }
  }

  const stored = await getUserById(platform, uid);
  if (live && stored) {
    return {
      profile: {
        id: stored.id,
        name: live.name || stored.name,
        firstName: live.firstName ?? stored.firstName,
        username: live.username ?? stored.username,
        avatarUrl: live.avatarUrl ?? stored.avatarUrl,
      },
      source: 'live',
    };
  }
  if (live) return { profile: live, source: 'live' };
  if (stored) return { profile: stored, source: 'stored' };
  return { profile: null, source: 'none' };
}

/**
 * Resolves the users mentioned in the triggering message to concrete user IDs,
 * excluding the bot itself. Event mentions arrive as a map:
 *   - numeric platform IDs  → { [userId]: '@username' | displayName }
 *   - '@handle' keys        → { ['@alice']: '@alice' } (Telegram @-mentions)
 */
async function resolveMentionedTargets(
  ctx: AppCtx,
  platform: string,
): Promise<Array<{ id: string; label: string }>> {
  const mentions = (ctx.event['mentions'] as Record<string, string> | undefined) ?? {};
  if (Object.keys(mentions).length === 0) return [];

  // The bot's own mention must never be reported as "the mentioned user".
  let botId = '';
  if (ctx.bot && typeof ctx.bot.getID === 'function') {
    try {
      botId = await ctx.bot.getID();
    } catch {
      // Cannot resolve the bot id — skip the bot-filter step
    }
  }

  const targets: Array<{ id: string; label: string }> = [];
  for (const [key, label] of Object.entries(mentions)) {
    if (key.startsWith('@')) {
      // Telegram @-mention — resolve the handle to a user id via the DB
      const profile = await getUserByUsername(platform, key.slice(1));
      if (profile) targets.push({ id: profile.id, label: key });
    } else if (/^\d+$/.test(key)) {
      targets.push({ id: key, label: label || key });
    }
    // Other key shapes are ignored — not a resolvable user reference
  }

  return botId ? targets.filter((t) => t.id !== botId) : targets;
}

// ============================================================================
// TOOL RUN
// ============================================================================

export const run = async (
  args: { uid?: unknown; username?: unknown },
  ctx: AppCtx,
): Promise<string> => {
  const rawUid = typeof args.uid === 'string' ? args.uid.trim() : '';
  const rawUsername =
    typeof args.username === 'string'
      ? args.username.trim().replace(/^@/, '')
      : '';

  const { senderID, threadID, platform } = resolveAgentContext(ctx);

  try {
    // ── 1. Explicit username ────────────────────────────────────────────────
    if (rawUsername) {
      const stored = await getUserByUsername(platform, rawUsername);
      if (!stored) {
        return `No user found with username: @${rawUsername} on ${platform}.`;
      }
      const { profile, source } = await resolveProfile(stored.id, ctx, platform);
      if (!profile) {
        return `No user found with username: @${rawUsername} on ${platform}.`;
      }
      return JSON.stringify(
        {
          uid: profile.id,
          name: profile.name,
          username: profile.username,
          firstName: profile.firstName,
          avatarUrl: profile.avatarUrl,
          exists: true,
          platform,
          lookupBy: 'username',
          source,
          currentThreadID: threadID || null,
        },
        null,
        2,
      );
    }

    // ── 2. Explicit uid ─────────────────────────────────────────────────────
    if (rawUid) {
      const { profile, source } = await resolveProfile(rawUid, ctx, platform);
      if (!profile) {
        return `No user found with id: ${rawUid}`;
      }
      return JSON.stringify(
        {
          uid: profile.id,
          name: profile.name,
          username: profile.username,
          firstName: profile.firstName,
          avatarUrl: profile.avatarUrl,
          exists: true,
          platform,
          lookupBy: 'uid',
          source,
          currentThreadID: threadID || null,
        },
        null,
        2,
      );
    }

    // ── 3. Mentioned user(s) from the triggering message ────────────────────
    const mentioned = await resolveMentionedTargets(ctx, platform);
    if (mentioned.length > 0) {
      const target = mentioned[0]!;
      const { profile, source } = await resolveProfile(
        target.id,
        ctx,
        platform,
      );
      if (!profile) {
        return `No user found with id: ${target.id}`;
      }
      return JSON.stringify(
        {
          uid: profile.id,
          name: profile.name,
          username: profile.username,
          firstName: profile.firstName,
          avatarUrl: profile.avatarUrl,
          exists: true,
          platform,
          lookupBy: 'mention',
          mention: target.label,
          source,
          currentThreadID: threadID || null,
        },
        null,
        2,
      );
    }

    // ── 4. Current sender — last resort ("who am I?") ───────────────────────
    if (senderID) {
      const { profile, source } = await resolveProfile(senderID, ctx, platform);
      if (!profile) {
        return `No user found with id: ${senderID}`;
      }
      return JSON.stringify(
        {
          uid: profile.id,
          name: profile.name,
          username: profile.username,
          firstName: profile.firstName,
          avatarUrl: profile.avatarUrl,
          exists: true,
          platform,
          lookupBy: 'current-sender',
          source,
          currentThreadID: threadID || null,
        },
        null,
        2,
      );
    }

    return 'No user id or username provided.';
  } catch (err) {
    return `User lookup error: ${err instanceof Error ? err.message : String(err)}`;
  }
};
