/**
 * checkwarn.ts — Cat-Bot event handler
 * Ported from GoatBot checkwarn.js by NTKhang.
 *
 * Listens for 'log:subscribe' events (member joins).
 * If any joining member has ≥3 active warnings, the bot
 * notifies the group and removes them immediately.
 *
 * Data is read from the same path written by warn.ts:
 *   db.threads.collection(threadID) → 'warn' collection → key 'list'
 *   Shape: WarnedUser[]
 *
 * Prefix resolution: 'prefix' is documented as available in onCommand only,
 * so the unban hint in the notification message resolves the live prefix via
 * prefixManager (thread override first, then session prefix, '/' fallback) —
 * identical to welcome.ts — instead of printing a bare 'warn unban' hint.
 *
 * ⚠️ GAP — deferred kick queue:
 *   The original GoatBot version queued a re-kick for when the bot
 *   was later promoted to admin (via global.GoatBot.onEvent).
 *   Cat-Bot has no documented equivalent. If removeUser() fails,
 *   the group is notified that admin permissions are needed.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { EventMeta } from '@/engine/types/module-config.types.js';
import { prefixManager } from '@/engine/modules/prefix/prefix-manager.lib.js';

// Update this if your bot's warn command is named differently
const COMMAND_NAME = 'warn';

// ─── Data shapes ─────────────────────────────────────────────────────────────

interface WarnedUser {
  uid: string;
  list: unknown[]; // WarnEntry[] — length is all we need here
}

// ─── Config ──────────────────────────────────────────────────────────────────

export const meta: EventMeta = {
  name: 'checkwarn',
  type: ['log:subscribe'],
  version: '1.3.0',
  author: 'NTKhang (Cat-Bot port)',
  description:
    'Auto-kicks rejoining members who have 3 or more active warnings',
};

// ─── Event handler ────────────────────────────────────────────────────────────

export const onEvent = async ({
  chat,
  event,
  db,
  thread,
  native,
}: AppCtx): Promise<void> => {
  const threadID = event['threadID'] as string;
  const data = event['logMessageData'] as Record<string, unknown> | undefined;
  const added =
    (data?.['addedParticipants'] as Record<string, unknown>[]) ?? [];

  // Resolve the live prefix for the unban hint: thread-level override first
  // (set via the /prefix command), falling back to the session-wide prefix.
  // Matches welcome.ts's resolution so the hint always shows a runnable command.
  const prefix =
    (threadID && prefixManager.getThreadPrefix(threadID)) ||
    (native.userId && native.sessionId
      ? prefixManager.getPrefix(native.userId, native.platform, native.sessionId)
      : '/');

  // Nothing to do if no participants were added
  if (!added.length) return;

  // If the warn collection doesn't exist, no warns have ever been issued here
  const coll = db.threads.collection(threadID);
  if (!(await coll.isCollectionExist('warn'))) return;

  const warnColl = await coll.getCollection('warn');
  const warnList = ((await warnColl.get('list')) as WarnedUser[] | null) ?? [];
  if (!warnList.length) return;

  for (const participant of added) {
    const uid = String(participant['userFbId'] ?? '');
    const fullName = String(
      participant['fullName'] ?? participant['firstName'] ?? `User ${uid}`,
    );

    if (!uid) continue;

    const entry = warnList.find((u) => u.uid === uid);
    if (!entry || entry.list.length < 3) continue;

    // Notify first, then attempt to remove
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `⚠️ **${fullName}** rejoined but is still banned (${entry.list.length} warnings).`,
        `- **Name:** ${fullName}`,
        `- **Uid:** ${uid}`,
        `\nTo lift the ban: \`${prefix}${COMMAND_NAME} unban ${uid}\``,
      ].join('\n'),
    });

    // ⚠️ GAP: No deferred retry if bot lacks admin at this moment.
    // The original GoatBot version would watch for a bot-admin promotion event
    // and retry. That pattern has no documented equivalent in Cat-Bot.
    try {
      await thread.removeUser(uid);
    } catch {
      await chat.replyMessage({
        message:
          '⚠️ Bot needs administrator permissions to remove banned members.',
      });
    }
  }
};
