/**
 * AI Agent — get_user tool
 *
 * Adaptation of canis src/components/ai/tools/userInfo.ts: canis reads a user
 * from its DB by lid; Cat-Bot resolves the user live through the platform API
 * via ToolContext.getUserInfo.
 */

import type { ToolMeta, ToolContext } from './types.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const meta: ToolMeta = {
  name: 'get_user',
  description:
    'Look up a chat user by their platform user ID and return their display info (name, username, avatar).',
  parameters: {
    type: 'object',
    properties: {
      uid: {
        type: 'string',
        description: "The user's platform ID (numeric for Discord/Telegram)",
      },
    },
    required: ['uid'],
  },
};

// ============================================================================
// TOOL RUN
// ============================================================================

export const initialize = async (
  { uid }: { uid?: string },
  ctx: ToolContext,
): Promise<string> => {
  const userID = (uid ?? '').trim();
  if (!userID) return 'No user ID provided.';
  try {
    const user = await ctx.getUserInfo(userID);
    if (!user) return `No user found with ID: ${userID}`;
    return JSON.stringify({
      name: user.name,
      username: user.username,
      firstName: user.firstName,
      avatarUrl: user.avatarUrl,
      platform: user.platform,
    });
  } catch (err: unknown) {
    return `Error looking up user: ${err instanceof Error ? err.message : String(err)}`;
  }
};
