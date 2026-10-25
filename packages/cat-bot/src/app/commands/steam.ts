/**
 * /steam — look up a Steam game or app by name.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  runSearch,
  steamSearchConfig,
} from '@/engine/services/commands/popcat-search.service.js';

const config = steamSearchConfig;

export const meta: CommandMeta = {
  name: 'steam',
  aliases: ['steamsearch'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Look up a Steam game or app by name.',
  category: 'search',
  usage: '<query>',
  cooldown: 8,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'q',
      description: 'Search query (e.g. "minecraft")',
      required: true,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runSearch(ctx, config);
