// goodbye.ts
//
// Native Cat-Bot port of the standalone "goodbye" event script.
//
// WHY THIS SHAPE:
//   Discord's guildMemberRemove and Telegram's left_chat_member are both
//   normalised into the same unified contract before reaching an event
//   module (see normalizeGuildMemberRemoveEvent / normalizeLeftChatMemberEvent):
//
//     event.type            === 'event'
//     event.logMessageType  === 'log:unsubscribe'
//     event.logMessageData  === { leftParticipantFbId: '<id>' }
//     event.logMessageBody  === '<Display Name> left the server/group.'
//
//   There is no `event.left_chat_member` on the unified object — that field
//   only exists on Telegram's raw ctx.message, which onEvent never receives
//   (onEvent always gets the normalised event, per the codebase-wide rule that
//   `event` here is NOT `event.message`). The left member's display name isn't
//   duplicated inside logMessageData (only their ID is), so it's read from
//   logMessageBody, which both platform normalizers already populate with the
//   name baked in — no extra API round-trip needed, and it works identically
//   whether the member left on their own or was removed.
//
// NOTE: This supersedes src/app/events/leave.ts (same eventType, same job).
//       Delete/rename leave.ts so both handlers don't fire and double-post.

import type { AppCtx } from '@/engine/types/controller.types.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { EventMeta } from '@/engine/types/module-config.types.js';
import { LogMessageType } from '@/engine/adapters/models/enums/index.js';
import { fetchGreetCanvas, normalizeCanvasPlatform } from '@/engine/lib/aqua-canvas.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

export const meta: EventMeta = {
  name: 'goodbye',
  eventType: [LogMessageType.UNSUBSCRIBE],
  version: '2.0.0',
  author: 'AjiroDesu',
  description:
    'Sends a farewell message when a member leaves the group (Discord & Telegram).',
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
    const leftId = String(logMessageData?.['leftParticipantFbId'] ?? '');
    if (!leftId) return;

    // Skip the bot's own removal/departure — nothing to announce to a group
    // the bot itself just left.
    const botId = await bot.getID();
    if (leftId === botId) return;

    // Both normalizers write a ready-made "<Name> left the server/group." string —
    // strip the trailing clause to recover just the display name. Falls back to a
    // generic label if the body is ever missing or in an unexpected shape.
    const body = (event['logMessageBody'] as string | undefined) ?? '';
    const name =
      body.replace(/\s+left\s+the\s+(server|group)\.?\s*$/i, '').trim() ||
      'Someone';

    const lines = [
      `👋 **Goodbye, ${name}!**`,
      ``,
      `Thanks for being part of the group. We'll miss you! 💙`,
      `You're always welcome back anytime. 🚪✨`,
    ];

    // Canvas card is best-effort: the departing user's avatar/profile can be
    // unresolvable right after they leave (esp. on Discord, once they drop
    // out of the guild member cache) — any failure here just keeps the
    // existing text-only farewell.
    const canvasPlatform = normalizeCanvasPlatform(native.platform);
    let canvasAttachment: { name: string; stream: Buffer } | undefined;
    const threadID = event['threadID'] as string | undefined;

    if (canvasPlatform) {
      try {
        const avatar = await api.getAvatarUrl(leftId);

        if (avatar) {
          const [groupName, memberCount] = await Promise.all([
            thread.getName().catch(() => null),
            threadID ? api.getMemberCount(threadID).catch(() => 0) : Promise.resolve(0),
          ]);

          const { buffer, ext } = await fetchGreetCanvas({
            type: 'Goodbye',
            platform: canvasPlatform,
            avatar,
            username: name,
            serverName: groupName || 'this group',
            message: `We'll miss you, ${name}!`,
            memberCount,
          });

          canvasAttachment = { name: `goodbye.${ext}`, stream: buffer };
        }
      } catch (err) {
        logger.warn('[goodbye] Canvas card failed, falling back to text', {
          leftId,
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
    console.error('❌ goodbye event handler failed:', err);
  }
};