// welcome.ts
//
// Native Cat-Bot port of the standalone "welcome" event script.
//
// WHY THIS SHAPE:
//   Cat-Bot normalises every platform's "member joined" event into the same
//   unified contract BEFORE it ever reaches an event module — Discord's
//   guildMemberAdd and Telegram's new_chat_members are both converted to:
//
//     event.type            === 'event'
//     event.logMessageType  === 'log:subscribe'
//     event.logMessageData  === { addedParticipants: [{ userFbId, firstName, fullName, ... }] }
//
//   (see src/engine/adapters/platform/discord/utils/normalizers.util.ts →
//   normalizeGuildMemberAddEvent, and .../telegram/utils/helper.util.ts →
//   normalizeNewChatMembersEvent). Because both platforms funnel into the
//   exact same shape, ONE handler subscribed to LogMessageType.SUBSCRIBE
//   is all that's needed for both platforms — there's no `event.new_chat_members`
//   here the way there was in the raw Telegram-only script; that field simply
//   doesn't exist on the unified `event` object, so reading it would always be
//   undefined. `logMessageData.addedParticipants` is the correct — and only —
//   place to read joiners from in onEvent.
//
// NOTE: This supersedes src/app/events/join.ts (same eventType, same job).
//       Delete/rename join.ts so both handlers don't fire and double-post.

import type { AppCtx } from '@/engine/types/controller.types.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { EventMeta } from '@/engine/types/module-config.types.js';
import { LogMessageType } from '@/engine/adapters/models/enums/index.js';
import { getBotNickname } from '@/engine/repos/session.repo.js';
import { prefixManager } from '@/engine/modules/prefix/prefix-manager.lib.js';
import { fetchGreetCanvas, normalizeCanvasPlatform } from '@/engine/lib/aqua-canvas.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

export const meta: EventMeta = {
  name: 'welcome',
  eventType: [LogMessageType.SUBSCRIBE],
  version: '2.0.0',
  author: 'AjiroDesu',
  description:
    'Welcomes new members to the group with a rich greeting (Discord & Telegram).',
};

export const onEvent = async ({
  event,
  chat,
  bot,
  thread,
  native,
  api,
}: AppCtx): Promise<void> => {
  try {
    const logMessageData = event['logMessageData'] as
      | Record<string, unknown>
      | undefined;
    const added =
      (logMessageData?.['addedParticipants'] as Record<string, unknown>[]) ??
      [];
    if (!added.length) return;

    // Skip the bot's own join (self-add on invite). Telegram's normalizer already
    // filters bots out of addedParticipants before this handler ever sees them;
    // Discord's guildMemberAdd does not carry an is_bot flag once normalised, so
    // the bot-self check below is what prevents the bot from "welcoming itself".
    const botId = await bot.getID();
    const joiners = added.filter(
      (p) => String(p['userFbId'] ?? '') !== botId,
    );
    if (!joiners.length) return;

    const getName = (p: Record<string, unknown>) =>
      String(p['fullName'] || p['firstName'] || `User ${p['userFbId']}`);

    // Resolve group name + configured bot nickname in parallel — neither blocks the other.
    const [groupName, nickname] = await Promise.all([
      thread.getName().catch(() => null),
      native.userId && native.sessionId
        ? getBotNickname(native.userId, native.platform, native.sessionId)
        : Promise.resolve(null),
    ]);

    // Resolve the live prefix for this thread: thread-level override first (set via
    // the /prefix command), falling back to the session-wide prefix. Thread overrides
    // are only cached once a message has passed through this thread since the last
    // restart — best-effort, same tradeoff already documented in checkwarn.ts.
    const threadID = event['threadID'] as string;
    const prefix =
      (threadID && prefixManager.getThreadPrefix(threadID)) ||
      (native.userId && native.sessionId
        ? prefixManager.getPrefix(native.userId, native.platform, native.sessionId)
        : '/');

    const botName = nickname || 'Cat-Bot';
    const group = groupName || 'this group';
    const mentions = joiners.map((p) => `**${getName(p)}**`).join(', ');
    const greeting =
      joiners.length === 1
        ? `Hey ${mentions}, we're glad you're here! 👋`
        : `Hey ${mentions}, welcome aboard! 👋`;

    const lines = [
      `🎉 **Welcome to ${group}!**`,
      ``,
      greeting,
      ``,
      `🤖 **I'm ${botName}** — your multipurpose AI assistant.`,
      `Type \`${prefix}help\` to explore everything I can do.`,
      ``,
      `Feel free to introduce yourself and enjoy your stay! 🌟`,
    ];

    // Canvas cards need a single avatar/username, so only attempt one for a
    // single-joiner event on a supported platform; bulk joins (or unsupported
    // platforms / any fetch failure) keep the existing text-only greeting.
    const canvasPlatform = normalizeCanvasPlatform(native.platform);
    let canvasAttachment: { name: string; stream: Buffer } | undefined;

    if (canvasPlatform && joiners.length === 1) {
      const joiner = joiners[0]!;
      const joinerId = String(joiner['userFbId'] ?? '');

      try {
        const avatar = joinerId ? await api.getAvatarUrl(joinerId) : null;

        if (avatar) {
          const joinerName = getName(joiner);
          const memberCount = await api.getMemberCount(threadID).catch(() => 0);

          const { buffer, ext } = await fetchGreetCanvas({
            type: 'Welcome',
            platform: canvasPlatform,
            avatar,
            username: joinerName,
            serverName: group,
            message: `Glad to have you here, ${joinerName}!`,
            memberCount,
          });

          canvasAttachment = { name: `welcome.${ext}`, stream: buffer };
        }
      } catch (err) {
        logger.warn('[welcome] Canvas card failed, falling back to text', {
          threadID,
          platform: native.platform,
          error: err,
        });
      }
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: lines.join('\n'),
      ...(canvasAttachment ? { attachment: [canvasAttachment] } : {}),
    });
  } catch (err) {
    console.error('❌ welcome event handler failed:', err);
  }
};