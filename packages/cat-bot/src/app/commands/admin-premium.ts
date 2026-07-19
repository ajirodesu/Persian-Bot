/**
 * Bot Admin / Premium Management — multi-command family (single file, config-driven)
 *
 * Merges the previously-standalone admin.ts and premium.ts modules into one
 * file. Both commands manage a session-scoped list of user IDs (bot admins /
 * premium users) via the exact same add/list/remove flow, gated by the same
 * "system admin or existing bot admin" authorisation check — only the
 * underlying repo functions and response copy differ, so they're expressed
 * here as one runList() handler + a small config table.
 *
 * Commands:
 *   /admin   — manage bot admins for this session    (add | list | remove)
 *   /premium — manage premium users for this session  (add | list | remove)
 *              also reachable as /vip (alias)
 *
 * ── Reply-based targeting ─────────────────────────────────────────────────────
 * `add`/`delete`/`remove` normally take the target's platform user ID as
 * args[1]. As an alternative, the caller may instead reply to the target
 * user's message — no ID needs to be typed at all: `/admin add` (or
 * `/premium add`) sent as a reply resolves the target directly from
 * event.messageReply.senderID. An explicit args[1] still wins when both are
 * present, so replying while also typing a different ID does what it looks
 * like — targets the typed ID, not the reply.
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand, button? }>` and registers
 * each entry exactly like a standalone command module.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import {
  addBotAdmin,
  removeBotAdmin,
  listBotAdmins,
  addBotPremium,
  removeBotPremium,
  listBotPremiums,
  isBotAdmin,
  isBotPremium,
} from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

// ── Config ────────────────────────────────────────────────────────────────────

interface ListConfig {
  name: string;
  /** Alternate command names that route to this same config. */
  aliases: string[];
  description: string;
  /** Noun used in user-facing copy, e.g. "bot admin" / "premium user". */
  noun: string;
  pluralNoun: string;
  /** Unauthorised-action noun, e.g. "add or remove admins" / "add or remove premium users". */
  authFailureAction: string;
  add: (userId: string, platform: string, sessionId: string, uid: string) => Promise<void>;
  remove: (userId: string, platform: string, sessionId: string, uid: string) => Promise<void>;
  list: (userId: string, platform: string, sessionId: string) => Promise<string[]>;
  /** Only /premium checks and short-circuits on a duplicate add. */
  alreadyExists?: (userId: string, platform: string, sessionId: string, uid: string) => Promise<boolean>;
}

const LIST_CONFIGS: ListConfig[] = [
  {
    name: 'admin',
    aliases: [],
    description: 'Manage bot admins for this session: add, list, or remove by user ID',
    noun: 'bot admin',
    pluralNoun: 'bot admins',
    authFailureAction: 'add or remove admins',
    add: addBotAdmin,
    remove: removeBotAdmin,
    list: listBotAdmins,
  },
  {
    name: 'premium',
    aliases: ['vip'],
    description: 'Manage premium (VIP) users for this session: add, list, or remove by user ID',
    noun: 'premium user',
    pluralNoun: 'premium users',
    authFailureAction: 'add or remove premium users',
    add: addBotPremium,
    remove: removeBotPremium,
    list: listBotPremiums,
    alreadyExists: isBotPremium,
  },
];

// ── Shared handler ────────────────────────────────────────────────────────────

async function runList(ctx: AppCtx, config: ListConfig): Promise<void> {
  const { chat, user, args, event, native, usage } = ctx;
  const { userId, platform, sessionId } = native;
  const senderID = event['senderID'] as string | undefined;

  // Reply-based target resolution: replying to a user's message lets the
  // caller manage that user directly without typing their ID. An explicit
  // args[1] still takes priority when both are present.
  const replyEvent = event['messageReply'] as
    | Record<string, unknown>
    | null
    | undefined;
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

    if (config.alreadyExists && (await config.alreadyExists(userId, platform, sessionId, uid))) {
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
    const names = await Promise.all(entries.map((id: string) => user.getName(id)));
    const lines = entries
      .map((id: string, i: number) => `${i + 1}. **${names[i] ?? id}** (${id})`)
      .join('\n');
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `**${config.pluralNoun[0]!.toUpperCase()}${config.pluralNoun.slice(1)} for this session (${entries.length}):**\n${lines}`,
    });
    return;
  }

  // Support both 'delete' and 'remove' keywords for better UX
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

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = LIST_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases,
    version: '1.1.0',
    role: Role.ANYONE,
    author: 'John Lester',
    description: config.description,
    category: 'Bot Admin',
    usage: '<add|list|remove> [uid]',
    guide: [
      'add <uid> — Add a user by ID',
      '  reply to the target user\'s message instead of typing an ID',
      'delete|remove <uid> — Remove a user by ID',
      '  reply to the target user\'s message instead of typing an ID',
      'list — Show the current list',
    ],
    cooldown: 5,
    hasPrefix: true,
    platform: [Platforms.Discord, Platforms.Telegram],
    options: [
      {
        type: OptionType.string,
        name: 'action',
        description: 'Action to perform: add, list, delete, or remove',
        required: true,
      },
      {
        type: OptionType.string,
        name: 'uid',
        description:
          'Platform user ID for add/delete/remove — omit and reply to the target user\'s message instead',
        required: false,
      },
    ],
  },
  onCommand: async (ctx: AppCtx) => runList(ctx, config),
}));
