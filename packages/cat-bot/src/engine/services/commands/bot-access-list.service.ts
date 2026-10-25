/**
 * Bot Access Lists — shared add/list/remove flow for /admin and /premium.
 *
 * Both commands manage a session-scoped list of user IDs and use the same
 * authorization rule: system admins may always manage the list, while bot
 * admins may manage it within their own session. Targets can be supplied as a
 * platform user ID or by replying to the target's message; an explicit ID
 * always wins when both are present.
 */

import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

export interface BotAccessListConfig {
  /** Canonical command name, used in the identity error message. */
  name: string;
  /** Noun used in user-facing copy, e.g. "bot admin". */
  noun: string;
  /** Plural noun used in list copy, e.g. "bot admins". */
  pluralNoun: string;
  /** Unauthorised-action phrase, e.g. "add or remove admins". */
  authFailureAction: string;
  add: (
    userId: string,
    platform: string,
    sessionId: string,
    uid: string,
  ) => Promise<void>;
  remove: (
    userId: string,
    platform: string,
    sessionId: string,
    uid: string,
  ) => Promise<void>;
  list: (
    userId: string,
    platform: string,
    sessionId: string,
  ) => Promise<string[]>;
  /** Only /premium checks and short-circuits on a duplicate add. */
  alreadyExists?: (
    userId: string,
    platform: string,
    sessionId: string,
    uid: string,
  ) => Promise<boolean>;
}

/** Runs the shared /admin and /premium flow. */
export async function runBotAccessList(
  ctx: AppCtx,
  config: BotAccessListConfig,
): Promise<void> {
  const { chat, user, args, event, native, usage } = ctx;
  const { userId, platform, sessionId } = native;
  const senderID = event['senderID'] as string | undefined;

  // Reply-based target resolution: replying to a user's message lets the
  // caller manage that user directly without typing their ID. An explicit
  // args[1] still takes priority when both are present.
  const replyEvent = event['messageReply'] as
    Record<string, unknown> | null | undefined;
  const repliedSenderID = replyEvent?.['senderID'] as string | undefined;
  const resolveTargetUid = (): string | undefined => args[1] || repliedSenderID;

  if (!userId || !platform || !sessionId) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Cannot resolve session identity — ${config.name} commands are unavailable.`,
    });
    return;
  }

  const sub = args[0]?.toLowerCase();

  if (sub === 'add' || sub === 'delete' || sub === 'remove') {
    // System admins hold global authority and may always manage this list.
    // Bot admins may manage it within their own session.
    const callerIsAuthorised = senderID
      ? (await isSystemAdmin(senderID)) ||
        (await isBotAdmin(userId, platform, sessionId, senderID))
      : false;

    if (!callerIsAuthorised) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `🚫 Only bot admins or system admins can ${config.authFailureAction}.`,
      });
      return;
    }
  }

  if (sub === 'add') {
    const uid = resolveTargetUid();
    if (!uid) {
      await usage();
      return;
    }

    if (
      config.alreadyExists &&
      (await config.alreadyExists(userId, platform, sessionId, uid))
    ) {
      const userName = await user.getName(uid);
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `ℹ️ **${userName}** is already a ${config.noun} for this session.`,
      });
      return;
    }

    await config.add(userId, platform, sessionId, uid);
    const userName = await user.getName(uid);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ **${userName}** is now a ${config.noun} for this session.`,
    });
    return;
  }

  if (sub === 'list') {
    const entries = await config.list(userId, platform, sessionId);
    if (entries.length === 0) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `ℹ️ No ${config.pluralNoun} registered for this session.`,
      });
      return;
    }

    const names = await Promise.all(entries.map((id) => user.getName(id)));
    const lines = entries
      .map((id, index) => `${index + 1}. **${names[index] ?? id}** (${id})`)
      .join('\n');

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `**${config.pluralNoun[0]!.toUpperCase()}${config.pluralNoun.slice(1)} for this session (${entries.length}):**\n${lines}`,
    });
    return;
  }

  // Support both 'delete' and 'remove' keywords for better UX.
  if (sub === 'delete' || sub === 'remove') {
    const uid = resolveTargetUid();
    if (!uid) {
      await usage();
      return;
    }

    await config.remove(userId, platform, sessionId, uid);
    const userName = await user.getName(uid);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ **${userName}** has been removed from ${config.pluralNoun}.`,
    });
    return;
  }

  await usage();
}
