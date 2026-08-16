/**
 * AI Agent — get_user tool
 *
 * Looks up a user by their platform user ID OR by username (without @).
 * Returns the user's FULL stored database profile, their complete per-user
 * data record (every collection the bot keeps: balance, XP, warns, daily
 * state, ...), plus live platform info when available.
 */

import type { ToolMeta, ToolContext } from '../agent-tool.types.js';
import {
  getUserById,
  getUserByUsername,
  getUserSessionData,
} from '@/engine/repos/users.repo.js';
import type { StoredUserProfile } from '@/engine/models/users.model.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'get_user',
  description:
    'Look up a chat user and return their full information: the complete stored ' +
    'database profile and data record plus live platform info. Search by either ' +
    '`uid` (platform user ID) or `username` (handle without @) — provide one of the two.',
  parameters: {
    type: 'object',
    properties: {
      uid: {
        type: 'string',
        description:
          "The user's platform ID (numeric for Discord/Telegram)",
      },
      username: {
        type: 'string',
        description:
          "The user's username/handle without @ (e.g. 'johndoe')",
      },
    },
  },
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  { uid, username }: { uid?: string; username?: string },
  ctx: ToolContext,
): Promise<string> => {
  const platform = ctx.native.platform ?? '';
  const userID = (uid ?? '').trim();
  const handle = (username ?? '').trim().replace(/^@/, '');

  if (!userID && !handle) {
    return 'Provide either `uid` (user ID) or `username` (handle without @).';
  }

  let profile: StoredUserProfile | null = null;

  // Username search resolves the ID from the stored profile.
  if (handle) {
    try {
      profile = await getUserByUsername(platform, handle);
    } catch {
      profile = null;
    }
  }

  const targetID = profile ? profile.id : userID;

  // ID search — either given directly, or fell back when username had no hit.
  if (targetID && !profile) {
    try {
      profile = await getUserById(platform, targetID);
    } catch {
      profile = null;
    }
  }

  if (!targetID) {
    return `No user found with username: ${handle}`;
  }

  // Live platform info + the user's full stored data record, in parallel.
  const [live, data] = await Promise.all([
    ctx.getUserInfo(targetID).catch(() => null),
    getUserSessionData(
      ctx.native.userId ?? '',
      platform,
      ctx.native.sessionId ?? '',
      targetID,
    ).catch(() => ({} as Record<string, unknown>)),
  ]);

  return JSON.stringify({
    profile,
    info: live
      ? {
          platform: live.platform,
          id: live.id,
          name: live.name,
          firstName: live.firstName,
          username: live.username,
          avatarUrl: live.avatarUrl,
        }
      : null,
    // The complete stored record — every collection the bot persists for this
    // user (balance, XP, warns, daily state, ...).
    data,
  });
};
