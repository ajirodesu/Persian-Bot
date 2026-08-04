// log.ts
//
// Native Cat-Bot event — bot membership audit log, sent to bot admins only.
//
// WHEN THIS FIRES:
//   Subscribes to both log:subscribe and log:unsubscribe (the same unified
//   membership events that power notice.ts / goodbye.ts), but ONLY reacts
//   when the participant being added/removed is the bot itself — mirrors
//   the self-join/self-leave detection already used in notice.ts and
//   goodbye.ts (bot.getID() compared against addedParticipants /
//   leftParticipantFbId).
//
// WHERE THIS SENDS:
//   Never to the group chat — only DM'd to every registered bot admin
//   (listBotAdmins), same delivery mechanism as /callad.

import type { AppCtx } from '@/engine/types/controller.types.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { EventMeta } from '@/engine/types/module-config.types.js';
import { LogMessageType } from '@/engine/adapters/models/enums/index.js';
import { listBotAdmins } from '@/engine/repos/credentials.repo.js';

export const meta: EventMeta = {
  name: 'log',
  type: ['log:subscribe', 'log:unsubscribe'],
  version: '1.0.0',
  author: 'AjiroDesu',
  description:
    'Sends a bot membership update log to bot admins when the bot is added to or removed from a group.',
};

export const onEvent = async ({
  event,
  chat,
  bot,
  thread,
  user,
  native,
  db,
}: AppCtx): Promise<void> => {
  try {
    const logMessageType = event['logMessageType'] as string | undefined;
    const botId = await bot.getID();

    let isAdded: boolean;
    let actorId: string;

    if (logMessageType === LogMessageType.SUBSCRIBE) {
      const logMessageData = event['logMessageData'] as
        | Record<string, unknown>
        | undefined;
      const added =
        (logMessageData?.['addedParticipants'] as
          | Record<string, unknown>[]
          | undefined) ?? [];
      const botJoined = added.some(
        (p) => String(p['userFbId'] ?? '') === botId,
      );
      if (!botJoined) return;
      isAdded = true;
      actorId = (event['author'] as string | undefined) ?? '';
    } else if (logMessageType === LogMessageType.UNSUBSCRIBE) {
      const logMessageData = event['logMessageData'] as
        | Record<string, unknown>
        | undefined;
      const leftId = String(logMessageData?.['leftParticipantFbId'] ?? '');
      if (!leftId || leftId !== botId) return;
      isAdded = false;
      actorId = (event['author'] as string | undefined) ?? '';
    } else {
      return;
    }

    const { userId, platform, sessionId } = native;
    if (!userId || !platform || !sessionId) return;

    const admins = await listBotAdmins(userId, platform, sessionId);
    if (admins.length === 0) return;

    const threadID = (event['threadID'] as string | undefined) ?? '';

    const [groupName, actorInfo, groupIds] = await Promise.all([
      thread.getName().catch(() => null),
      actorId
        ? user.getInfo(actorId).catch(() => null)
        : Promise.resolve(null),
      db.threads.getGroupIds().catch(() => []),
    ]);

    const chatName = groupName || 'Unknown';
    const actorLabel = actorInfo
      ? actorInfo.username
        ? `@${actorInfo.username}`
        : actorInfo.name
      : 'Unknown';
    const activeChats = groupIds.length;

    const message = isAdded
      ? [
          '✅ **Bot Membership Update**',
          '',
          '📥 **Status:** Added to New Group',
          `💬 **Chat:** ${chatName}`,
          `🆔 **Chat ID:** "${threadID}"`,
          `👤 **Added By:** ${actorLabel}`,
          `📊 **Active Chats:** ${activeChats}`,
        ].join('\n')
      : [
          '🚫 **Bot Membership Update**',
          '',
          '📤 **Status:** Removed from Group',
          `💬 **Chat:** ${chatName}`,
          `🆔 **Chat ID:** "${threadID}"`,
          `👤 **Removed By:** ${actorLabel}`,
          `📊 **Active Chats:** ${activeChats}`,
        ].join('\n');

    await Promise.allSettled(
      admins.map((adminId) =>
        chat.reply({
          style: MessageStyle.MARKDOWN,
          message,
          thread_id: adminId,
        }),
      ),
    );
  } catch (err) {
    console.error('❌ log event handler failed:', err);
  }
};