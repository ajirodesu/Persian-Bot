/**
 * /periodictable — look up a chemical element by name or symbol.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  runPeriodicTable,
  type PeriodicTableConfig,
} from '@/engine/services/commands/periodic-table.service.js';

const config = {
  name: 'periodictable',
  path: '/v2/periodic-table',
  needsQuery: true,
} satisfies PeriodicTableConfig;

export const meta: CommandMeta = {
  name: 'periodictable',
  aliases: ['pt', 'element'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Look up a chemical element by name or symbol.',
  category: 'image',
  usage: '<element>',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'element',
      description: 'Element name or symbol (e.g. "bohrium" or "Bh")',
      required: true,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runPeriodicTable(ctx, config);
