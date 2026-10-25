/**
 * /setmoney — set a user money balance (bot admin).
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
  setMoneyConfig,
} from '@/engine/services/commands/set-stats.service.js';

const config = setMoneyConfig;

export const meta: CommandMeta = {
  name: 'setmoney',
  aliases: [],
  version: '1.0.0',
  role: Role.BOT_ADMIN,
  author: 'System',
  description:
    'Set the dollar balance of yourself, a @mentioned user, or a user by ID. Use "infinity" for ∞ dollars.',
  category: 'Bot Admin',
  usage:
    'me <amount|infinity> | del me | del @mention | @mention <amount|infinity> | uid <id> <amount|infinity>',
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
