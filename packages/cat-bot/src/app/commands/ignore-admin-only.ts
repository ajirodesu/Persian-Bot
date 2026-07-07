/**
 * Admin-Only Ignore Lists — multi-command family (single file, config-driven)
 *
 * Merges the previously-standalone ignoreonlyad.ts and ignoreonlyadminbox.ts
 * modules (Cat-Bot ports of GoatBot's ignoreonlyad / ignoreonlyadbox by
 * NTKhang) into one file. Both manage an add/del/list ignore-list of command
 * names exempt from an admin-only restriction — only the scope and backing
 * collection differ:
 *
 *   /ignoreonlyad       — session-wide list, exempts commands from /adminonly    (db.bot)
 *   /ignoreonlyadminbox — per-thread list,   exempts commands from /onlyadminbox (db.threads)
 *
 * so they're expressed here as one runIgnoreList() handler + a small config
 * table that supplies the DB handle getter, role, and response copy.
 *
 * ⚠️ GAP — command existence check:
 *   GoatBot verified the command name via global.GoatBot.commands.get().
 *   Cat-Bot's documented API provides no equivalent. The check is omitted;
 *   any string can be added to either ignore list.
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand, button? }>` and registers
 * each entry exactly like a standalone command module.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';

// ── Config ────────────────────────────────────────────────────────────────────

interface IgnoreListHandle {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

interface IgnoreListConfig {
  name: string;
  aliases: string[];
  version: string;
  description: string;
  scopeLabel: string; // "session" | "thread"
  ignoreListField: string;
  requiresGroup: boolean;
  getHandle: (ctx: AppCtx) => Promise<IgnoreListHandle>;
}

const IGNORE_LIST_CONFIGS: IgnoreListConfig[] = [
  {
    name: 'ignoreonlyad',
    aliases: ['ignoreadonly', 'ignoreonlyadmin', 'ignoreadminonly'],
    version: '1.2.0',
    description: 'Manage commands exempt from the session-wide admin-only restriction.',
    scopeLabel: 'session',
    ignoreListField: 'adminOnlyIgnoreList',
    requiresGroup: false,
    // Shared schema with /adminonly.
    getHandle: async ({ db }) => {
      const coll = db.bot;
      if (!(await coll.isCollectionExist('session_settings'))) {
        await coll.createCollection('session_settings');
        const h = await coll.getCollection('session_settings');
        await h.set('adminOnlyEnabled', false);
        await h.set('adminOnlyHideNoti', false);
        await h.set('adminOnlyIgnoreList', []);
        return h;
      }
      return coll.getCollection('session_settings');
    },
  },
  {
    // NOTE: the original standalone file was named ignoreonlyadminbox.ts, but
    // its registered command name (meta.name) was 'ignoreonlyadbox' — kept
    // as-is here so existing usages of the command keep working.
    name: 'ignoreonlyadbox',
    aliases: ['ignoreadboxonly', 'ignoreadminboxonly'],
    version: '1.2.0',
    description: 'Manage commands exempt from the per-thread admin-only restriction.',
    scopeLabel: 'thread',
    ignoreListField: 'ignoreList',
    requiresGroup: true,
    // Shared schema with /onlyadminbox.
    getHandle: async ({ db, event }) => {
      const threadID = event['threadID'] as string;
      const coll = db.threads.collection(threadID);
      if (!(await coll.isCollectionExist('adminbox_settings'))) {
        await coll.createCollection('adminbox_settings');
        const h = await coll.getCollection('adminbox_settings');
        await h.set('enabled', false);
        await h.set('hideNoti', false);
        await h.set('ignoreList', []);
        return h;
      }
      return coll.getCollection('adminbox_settings');
    },
  },
];

// ── Shared handler ────────────────────────────────────────────────────────────

async function runIgnoreList(ctx: AppCtx, config: IgnoreListConfig): Promise<void> {
  const { chat, args, event, usage } = ctx;

  if (config.requiresGroup && !event['isGroup']) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ This command can only be used in group chats.',
    });
    return;
  }

  const sub = args[0]?.toLowerCase();
  const handle = await config.getHandle(ctx);

  // ── add ───────────────────────────────────────────────────────────────────
  if (sub === 'add') {
    if (!args[1]) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '⚠️ Please enter the command name you want to add to the ignore list.',
      });
      return;
    }
    const commandName = args[1].toLowerCase();
    const ignoreList = ((await handle.get(config.ignoreListField)) as string[] | null) ?? [];

    if (ignoreList.includes(commandName)) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ **${commandName}** is already in the ignore list.`,
      });
      return;
    }

    ignoreList.push(commandName);
    await handle.set(config.ignoreListField, ignoreList);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Added **${commandName}** to the ${config.scopeLabel} ignore list.`,
    });
    return;
  }

  // ── del / delete / remove / rm / -d ──────────────────────────────────────
  if (['del', 'delete', 'remove', 'rm', '-d'].includes(sub ?? '')) {
    if (!args[1]) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '⚠️ Please enter the command name you want to remove from the ignore list.',
      });
      return;
    }
    const commandName = args[1].toLowerCase();
    const ignoreList = ((await handle.get(config.ignoreListField)) as string[] | null) ?? [];
    const idx = ignoreList.indexOf(commandName);

    if (idx === -1) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ **${commandName}** is not in the ignore list.`,
      });
      return;
    }

    ignoreList.splice(idx, 1);
    await handle.set(config.ignoreListField, ignoreList);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Removed **${commandName}** from the ${config.scopeLabel} ignore list.`,
    });
    return;
  }

  // ── list ──────────────────────────────────────────────────────────────────
  if (sub === 'list') {
    const ignoreList = ((await handle.get(config.ignoreListField)) as string[] | null) ?? [];
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        ignoreList.length === 0
          ? `📑 The ${config.scopeLabel} ignore list is currently empty.`
          : `📑 Commands exempt from admin-only (${config.scopeLabel}):\n${ignoreList.join(', ')}`,
    });
    return;
  }

  return usage();
}

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = IGNORE_LIST_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases,
    version: config.version,
    role: Role.BOT_ADMIN,
    author: 'NTKhang (Cat-Bot port)',
    description: config.description,
    category: config.scopeLabel === 'session' ? 'Bot Admin' : 'Thread Admin',
    usage: [
      `add <commandName> — Add a command to the ${config.scopeLabel} ignore list`,
      `del <commandName> — Remove a command from the ${config.scopeLabel} ignore list`,
      'list — View the current ignore list',
    ],
    cooldown: 5,
    hasPrefix: true,
    platform: [Platforms.Discord, Platforms.Telegram],
    options: [
      {
        type: OptionType.string,
        name: 'action',
        description: 'add, del, or list',
        required: true,
      },
      {
        type: OptionType.string,
        name: 'command',
        description: `Command name to add or remove from the ${config.scopeLabel} ignore list`,
        required: false,
      },
    ],
  },
  onCommand: async (ctx: AppCtx) => runIgnoreList(ctx, config),
}));
