/**
 * AI Agent — get_group tool
 *
 * Returns a group/thread's LIVE platform info plus its FULL stored database
 * record (every collection/setting the bot keeps for that thread: warns,
 * adminbox state, badwords, feature flags, etc.).
 *
 * `tid` is optional — when omitted, the current group (the thread the message
 * arrived in) is used. A provided `tid` still works for looking up other
 * groups.
 */

import type { ToolMeta, ToolContext } from '../agent-tool.types.js';
import { getThreadSessionData } from '@/engine/repos/threads.repo.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'get_group',
  description:
    'Look up a group/chat and return its full information: live platform data ' +
    '(name, member count, participants, admins, type) plus the complete stored ' +
    'database record for that thread. `tid` is optional — omit it to inspect the ' +
    'current group, or pass a `tid` to inspect any other group/chat the bot knows.',
  parameters: {
    type: 'object',
    properties: {
      tid: {
        type: 'string',
        description:
          'Optional thread/group ID (e.g. a Discord channel ID or Telegram chat ID). ' +
          'When omitted, the current group is used.',
      },
    },
  },
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  { tid }: { tid?: string },
  ctx: ToolContext,
): Promise<string> => {
  const provided = (tid ?? '').trim();
  const threadID =
    provided || ((ctx.event['threadID'] as string) ?? '').trim();

  if (!threadID) {
    return 'No thread ID provided and there is no current group context to inspect.';
  }

  // Live platform info + the full stored DB record, resolved in parallel.
  const [live, database] = await Promise.all([
    ctx.getThreadInfo(threadID),
    getThreadSessionData(
      ctx.native.userId ?? '',
      ctx.native.platform ?? '',
      ctx.native.sessionId ?? '',
      threadID,
    ).catch(() => ({} as Record<string, unknown>)),
  ]);

  return JSON.stringify({
    threadID,
    info: live
      ? {
          platform: live.platform,
          name: live.name,
          isGroup: live.isGroup,
          memberCount: live.memberCount,
          participantCount: live.participantIDs?.length ?? 0,
          participantIDs: live.participantIDs ?? [],
          adminIDs: live.adminIDs ?? [],
          avatarUrl: live.avatarUrl,
          serverID: live.serverID ?? null,
          channelName: live.channelName ?? null,
          channelType: live.channelType ?? null,
          type: live.type ?? null,
        }
      : null,
    // The complete stored record — every collection the bot persists for this
    // thread (warns, adminbox settings, badwords, toggles, ...).
    database,
  });
};
