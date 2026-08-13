// notice.ts
//
// Native Cat-Bot event — the bot's own "I've joined" announcement.
//
// WHEN THIS FIRES:
//   Subscribes to log:subscribe, the same unified join event that powers
//   welcome.ts, but ONLY reacts when the added participant is the bot itself
//   (its ID appears in logMessageData.addedParticipants). welcome.ts filters
//   the bot out of its greeting (see its self-join skip), so this file owns
//   the bot-added narrative without double-posting for ordinary joins.
//
//   Both platform normalizers funnel into the same shape — Discord
//   normalizeGuildMemberAddEvent and Telegram normalizeNewChatMembersEvent
//   both produce:
//
//     event.type            === 'event'
//     event.logMessageType  === 'log:subscribe'
//     event.logMessageData  === { addedParticipants: [{ userFbId, ... }] }
//
//   Telegram's normalizer deliberately KEEPS bots in addedParticipants
//   (tagged `isBot: true`) so a self-join — an admin adding the bot — lands
//   here; welcome.ts/checkwarn.ts skip bot participants on their own.
//
// PREFIX RESOLUTION:
//   'prefix' is only injected in onCommand contexts, so the /help hint is
//   built from prefixManager (thread override → session prefix → '/'),
//   identical to checkwarn.ts and welcome.ts.

import type { AppCtx } from '@/engine/types/controller.types.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { EventMeta } from '@/engine/types/module-meta.types.js';
import { getBotNickname } from '@/engine/repos/session.repo.js';
import { prefixManager } from '@/engine/modules/prefix/prefix-manager.lib.js';

export const meta: EventMeta = {
  name: 'notice',
  type: ['log:subscribe'],
  version: '1.0.0',
  author: 'AjiroDesu',
  description:
    'Announces the bot when it is added to a group (Discord & Telegram).',
};

export const onEvent = async ({
  event,
  chat,
  bot,
  thread,
  native,
}: AppCtx): Promise<void> => {
  try {
    const logMessageData = event['logMessageData'] as
      | Record<string, unknown>
      | undefined;
    const added =
      (logMessageData?.['addedParticipants'] as Record<string, unknown>[]) ??
      [];
    if (!added.length) return;

    // Only fire when the bot itself is one of the added participants —
    // an admin (or invite link) adding the bot to the group.
    const botId = await bot.getID();
    const botJoined = added.some(
      (p) => String(p['userFbId'] ?? '') === botId,
    );
    if (!botJoined) return;

    // Resolve group name + configured bot nickname in parallel — neither blocks the other.
    const [groupName, nickname] = await Promise.all([
      thread.getName().catch(() => null),
      native.userId && native.sessionId
        ? getBotNickname(native.userId, native.platform, native.sessionId)
        : Promise.resolve(null),
    ]);

    // Resolve the live prefix for the /help hint: thread-level override first
    // (set via the /prefix command), falling back to the session-wide prefix.
    const threadID = event['threadID'] as string;
    const prefix =
      (threadID && prefixManager.getThreadPrefix(threadID)) ||
      (native.userId && native.sessionId
        ? prefixManager.getPrefix(native.userId, native.platform, native.sessionId)
        : '/');

    const group = groupName || 'this group';
    const botName = nickname || 'Cat-Bot';

    const lines = [
      `🎉 **Hello everyone in ${group}!**`,
      ``,
      `I'm **${botName}** — your multipurpose AI assistant, and I've just joined the party! 👋`,
      ``,
      `🤖 Type \`${prefix}help\` to explore everything I can do.`,
      `💬 Just say my name — e.g. "Hi **${botName}**" — and I'll respond automatically!`,
      ``,
      `Excited to be here — let's get started! 🌟`,
    ];

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: lines.join('\n'),
    });
  } catch (err) {
    console.error('❌ notice event handler failed:', err);
  }
};
