/**
 * get_group Tool — Look up a bot group/chat in the database by its group id
 *
 * Ports project-canis's groupInfo tool (mrepol742/project-canis
 * src/components/ai/tools/groupInfo.ts) into Cat-Bot's native agent tool shape
 * (config + run, dynamically loaded by agent.ts).
 *
 * Cat-Bot is a multi-platform bot (Discord, Telegram, webchat), so the
 * WhatsApp-specific "gid" concept maps to the stored thread/group id — the
 * numeric part of the group JID without the @g.us suffix. The lookup reads the
 * LRU-cached bot_threads row synced by on-chat.middleware.
 */

import { getGroupById } from '@/engine/repos/threads.repo.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'get_group',
  description:
    'Look up a bot group/chat in the database by its group id (the numeric part of the group JID, without any platform suffix such as @g.us).',
  parameters: {
    type: 'object',
    properties: {
      groupId: {
        type: 'string',
        description:
          "The group's id, e.g. '120363000000000000' (no @g.us suffix)",
      },
    },
    required: ['groupId'],
  },
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const run = async ({
  groupId,
}: {
  groupId?: string;
}): Promise<string> => {
  const id = (groupId ?? '').trim();
  if (!id) return 'No group id provided.';

  const group = await getGroupById(id);
  if (!group) return `No group found with id: ${id}`;

  return JSON.stringify({
    id: group.id,
    platformId: group.platformId,
    name: group.name,
    isGroup: group.isGroup,
    type: group.type,
    memberCount: group.memberCount,
    avatarUrl: group.avatarUrl,
    createdAt: group.createdAt,
  });
};