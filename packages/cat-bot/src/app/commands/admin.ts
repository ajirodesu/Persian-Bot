/**
 * /admin — manage bot admins for this session.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  addBotAdmin,
  listBotAdmins,
  removeBotAdmin,
} from '@/engine/repos/credentials.repo.js';
import {
  runBotAccessList,
  type BotAccessListConfig,
} from '@/engine/services/commands/bot-access-list.service.js';

const config = {
  name: 'admin',
  noun: 'bot admin',
  pluralNoun: 'bot admins',
  authFailureAction: 'add or remove admins',
  add: addBotAdmin,
  remove: removeBotAdmin,
  list: listBotAdmins,
} satisfies BotAccessListConfig;

export const meta: CommandMeta = {
  name: 'admin',
  aliases: [],
  version: '1.1.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description:
    'Manage bot admins for this session: add, list, or remove by user ID',
  category: 'Bot Admin',
  usage: '<add|list|remove> [uid]',
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
        "Platform user ID for add/delete/remove — omit and reply to the target user's message instead",
      required: false,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runBotAccessList(ctx, config);
