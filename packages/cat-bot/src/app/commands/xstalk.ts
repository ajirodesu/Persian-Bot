/**
 * /xstalk — look up an X (Twitter) profile.
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
  runStalker,
  xStalkerConfig,
} from '@/engine/services/commands/stalker.service.js';

const config = xStalkerConfig;

export const meta: CommandMeta = {
  name: 'xstalk',
  aliases: ['twitter'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Stalk an X (Twitter) user profile.',
  category: 'Utility',
  usage: '<username>',
  cooldown: 5,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram],
  options: [
    {
      type: OptionType.string,
      name: 'username',
      description: 'X / Twitter username to look up',
      required: true,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runStalker(ctx, config);
