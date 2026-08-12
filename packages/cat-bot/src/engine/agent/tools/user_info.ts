/**
 * get_user Tool — Look up a bot user in the database by their platform user id
 *
 * Ports project-canis's userInfo tool (mrepol742/project-canis
 * src/components/ai/tools/userInfo.ts) into Cat-Bot's native agent tool shape
 * (config + run, dynamically loaded by agent.ts).
 *
 * Cat-Bot is a multi-platform bot (Discord, Telegram, webchat), so the
 * WhatsApp-specific "lid" concept maps to the stored platform user id — the
 * numeric part of a user's ID without any platform suffix. The lookup reads the
 * LRU-cached bot_users row synced by on-chat.middleware.
 */

import { getUserById } from '@/engine/repos/users.repo.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const config = {
  name: 'get_user',
  description:
    'Look up a bot user in the database by their platform user id (the numeric part of their ID, without any platform suffix such as @c.us or @s.whatsapp.net).',
  parameters: {
    type: 'object',
    properties: {
      userId: {
        type: 'string',
        description:
          "The user's platform id, e.g. '1234567890' (no @c.us or @s.whatsapp.net suffix)",
      },
    },
    required: ['userId'],
  },
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const run = async ({
  userId,
}: {
  userId?: string;
}): Promise<string> => {
  const id = (userId ?? '').trim();
  if (!id) return 'No user id provided.';

  const user = await getUserById(id);
  if (!user) return `No user found with id: ${id}`;

  return JSON.stringify({
    id: user.id,
    platformId: user.platformId,
    name: user.name,
    firstName: user.firstName,
    username: user.username,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  });
};