/**
 * AI Agent — get_group tool
 *
 * Adaptation of canis src/components/ai/tools/groupInfo.ts: canis reads a group
 * from its DB by gid; Cat-Bot resolves the thread/group live through the
 * platform API via ToolContext.getThreadInfo.
 */

import type { ToolMeta, ToolContext } from './types.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'get_group',
  description:
    'Look up a group/chat by its thread ID and return its display info (name, member count, type).',
  parameters: {
    type: 'object',
    properties: {
      tid: {
        type: 'string',
        description:
          "The thread/group ID (e.g. a Discord channel ID or Telegram chat ID)",
      },
    },
    required: ['tid'],
  },
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  { tid }: { tid?: string },
  ctx: ToolContext,
): Promise<string> => {
  const threadID = (tid ?? '').trim();
  if (!threadID) return 'No thread ID provided.';
  try {
    const thread = await ctx.getThreadInfo(threadID);
    if (!thread) return `No group found with ID: ${threadID}`;
    return JSON.stringify({
      name: thread.name,
      isGroup: thread.isGroup,
      memberCount: thread.memberCount,
      participantCount: thread.participantIDs?.length ?? 0,
      type: thread.type ?? thread.channelType ?? null,
    });
  } catch (err: unknown) {
    return `Error looking up group: ${err instanceof Error ? err.message : String(err)}`;
  }
};
