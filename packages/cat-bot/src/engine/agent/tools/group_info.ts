/**
 * get_group Tool — Live Chat/Group Info (Auto-Detects Current Chat)
 *
 * Converted from project-canis (src/components/ai/tools/groupInfo.ts).
 * The original looks up a WhatsApp group by gid; Cat-Bot's equivalent identity
 * is a thread ID — the platform-namespaced ID of any chat the bot knows about
 * (Telegram group id, Discord server/channel id, etc.).
 *
 * Two lookup modes:
 *   - `gid` provided  → returns the info for that specific chat/group
 *   - `gid` omitted   → auto-detects the CURRENT chat the command was used in
 *     (the triggering thread), resolving Discord channels to their server so
 *     the reported ID is the real group, not a sub-channel
 *
 * Data comes from the platform system itself (ctx.thread.getInfo →
 * getFullThreadInfo: getChat/getChatMemberCount on Telegram, guild.memberCount
 * on Discord/Fluxer), so the reported member count is the ACTUAL count from
 * the platform API — cached for 30 minutes like every other live-info read.
 * When the live fetch is unavailable, stored DB fields (name, group status)
 * are used and `infoSource: 'stored'` is reported. Never throws — DB/API
 * errors return a descriptive string.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { resolveAgentContext } from '../agent.util.js';
import {
  threadExists,
  getThreadName,
  getAllGroupThreadIds,
  getDiscordServerIdByChannel,
} from '@/engine/repos/threads.repo.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'get_group',
  description:
    'Look up a chat/group and get its ACTUAL information: name, member count, ' +
    'admin count, and whether it is a group. ' +
    "Pass `gid` (the chat's thread ID, e.g. '-1001234567890') to look up that " +
    'specific chat, or omit `gid` to automatically look up the chat/group where ' +
    'the command is currently being used. Member counts come live from the ' +
    'platform API.',
  parameters: {
    type: 'object',
    properties: {
      gid: {
        // ['string', 'null'] — models frequently pass null for skipped optional
        // args; Groq rejects a bare type: 'string' server-side (400
        // tool_use_failed) when the value is null.
        type: ['string', 'null'],
        description:
          "Optional. The chat/group's thread ID, e.g. '-1001234567890'. " +
          'Omit to auto-detect the current chat.',
      },
    },
    required: [],
  },
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const run = async (
  args: { gid?: unknown },
  ctx: AppCtx,
): Promise<string> => {
  const { threadID, sessionUserId, sessionId, platform } =
    resolveAgentContext(ctx);

  const providedGid = typeof args.gid === 'string' ? args.gid.trim() : '';
  let gid = providedGid;
  let source: 'provided' | 'current-thread' = 'provided';

  // Auto-detect the current chat when no gid is given.
  if (!gid) {
    gid = threadID;
    source = 'current-thread';
  }
  if (!gid) {
    return 'No gid provided and the current thread ID could not be resolved.';
  }

  try {
    // On Discord the "real" group is the server (guild). A channel ID maps to
    // its server via the channel→server link; an unmapped ID is treated as a
    // server ID directly (threadExists/getThreadName handle that fallback).
    if (platform === Platforms.Discord) {
      const serverId = await getDiscordServerIdByChannel(gid);
      if (serverId) gid = serverId;
    }

    if (!(await threadExists(platform, gid))) {
      return source === 'current-thread'
        ? `The current chat (${gid}) is not a tracked group.`
        : `No chat found with thread id: ${gid}`;
    }

    // Live info straight from the platform system (member count, admins,
    // participants, name). ctx.thread.getInfo is LRU-cached (30 min) like the
    // rest of the engine's live-info reads.
    let live: {
      name: string | null;
      isGroup: boolean;
      memberCount: number | null;
      participantIDs: string[];
      adminIDs: string[];
    } | null = null;
    if (ctx.thread && typeof ctx.thread.getInfo === 'function') {
      try {
        const info = await ctx.thread.getInfo(gid);
        if (info && info.threadID) live = info;
      } catch {
        live = null; // live unavailable — fall back to stored fields
      }
    }

    const name = live?.name ?? (await getThreadName(gid));

    // isGroup: live result is authoritative; otherwise check the session's
    // tracked group list (bot_threads with is_group=1, plus Discord servers).
    let isGroup = live?.isGroup ?? false;
    if (!live && sessionUserId && sessionId) {
      const groups = await getAllGroupThreadIds(
        sessionUserId,
        platform,
        sessionId,
      );
      isGroup = groups.includes(gid);
    }

    return JSON.stringify(
      {
        gid,
        name,
        isGroup,
        memberCount: live?.memberCount ?? null,
        participantCount:
          live && live.participantIDs.length > 0
            ? live.participantIDs.length
            : null,
        adminCount:
          live && live.adminIDs.length > 0 ? live.adminIDs.length : null,
        platform,
        source,
        infoSource: live ? 'live' : 'stored',
      },
      null,
      2,
    );
  } catch (err) {
    return `Group lookup error: ${err instanceof Error ? err.message : String(err)}`;
  }
};
