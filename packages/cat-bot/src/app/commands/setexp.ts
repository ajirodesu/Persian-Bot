/**
 * /setexp — set a user EXP balance (bot admin).
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  runSetStat,
  setExpConfig,
} from '@/engine/services/commands/set-stats.service.js';

const config = setExpConfig;

export const meta: CommandMeta = {
  name: 'setexp',
  aliases: [],
  version: '1.0.0',
  role: Role.BOT_ADMIN,
  author: 'System',
  description: 'Set the EXP of yourself, a @mentioned user, or a user by ID',
  category: 'Bot Admin',
  usage:
    'me <amount> | del me | del @mention | @mention <amount> | uid <id> <amount>',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'action',
      description:
        'me <amount> | del me | del @mention | @mention <amount> | uid <id> <amount>',
      required: true,
    },
    {
      type: OptionType.string,
      name: 'value',
      description: 'Amount or target user ID (context-dependent)',
      required: false,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runSetStat(ctx, config);
