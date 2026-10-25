/**
 * /ignoreonlyad — manage commands exempt from session-wide admin-only mode.
 *
 * Thin command module: metadata and registration only. The add/del/list flow
 * lives in the shared admin-only settings service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  runAdminOnlyIgnoreList,
  type AdminOnlyIgnoreListConfig,
} from '@/engine/services/commands/admin-only-settings.service.js';

const config = {
  scope: 'session',
  scopeLabel: 'session',
  ignoreListField: 'adminOnlyIgnoreList',
  requiresGroup: false,
} satisfies AdminOnlyIgnoreListConfig;

export const meta: CommandMeta = {
  name: 'ignoreonlyad',
  aliases: ['ignoreadonly', 'ignoreonlyadmin', 'ignoreadminonly'],
  version: '1.2.0',
  role: Role.BOT_ADMIN,
  author: 'NTKhang (Cat-Bot port)',
  description:
    'Manage commands exempt from the session-wide admin-only restriction.',
  category: 'Bot Admin',
  usage: [
    'add <commandName> — Add a command to the session ignore list',
    'del <commandName> — Remove a command from the session ignore list',
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
      description: 'Command name to add or remove from the session ignore list',
      required: false,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runAdminOnlyIgnoreList(ctx, config);
