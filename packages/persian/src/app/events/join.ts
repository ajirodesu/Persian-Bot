// join.ts

import type { AppCtx } from '@/engine/types/controller.types.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { EventMeta } from '@/engine/types/module-config.types.js';

export const meta: EventMeta = {
  name: 'join',
  eventType: ['log:subscribe'],
  version: '1.0.0',
  author: 'John Lester',
  description: 'Sends a welcome message when members join the group',
};

export const onEvent = async ({ event, chat, bot }: AppCtx) => {
  try {
    const logMessageData = event['logMessageData'] as
      | Record<string, unknown>
      | undefined;
    const added =
      (logMessageData?.['addedParticipants'] as Record<string, unknown>[]) ??
      [];

    if (!added.length) return;

    const botId = await bot.getID();
    if (added.some((p) => String(p['userFbId'] ?? '') === botId)) return;

    const getName = (p: Record<string, unknown>) =>
      String(p['fullName'] || p['firstName'] || `User ${p['userFbId']}`);

    let message: string;
    if (added.length === 1) {
      message = `👋 Welcome to the group, **${getName(added[0]!)}**!`;
    } else {
      const names = added.map((p) => `• **${getName(p)}**`).join('\n');
      message = `👋 Welcome to the group!\n\n${names}`;
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message,
    });
  } catch (err) {
    console.error('❌ join event handler failed:', err);
  }
};