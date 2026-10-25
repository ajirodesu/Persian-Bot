/**
 * /randomperiodictable — get a random chemical element.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  createPeriodicTableButton,
  runPeriodicTable,
  type PeriodicTableConfig,
} from '@/engine/services/commands/periodic-table.service.js';

const config = {
  name: 'randomperiodictable',
  path: '/v2/periodic-table/random',
  hasRerollButton: true,
} satisfies PeriodicTableConfig;

export const meta: CommandMeta = {
  name: 'randomperiodictable',
  aliases: ['ptrandom', 'randomelement'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Get a random chemical element from the periodic table.',
  category: 'image',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
  options: [],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runPeriodicTable(ctx, config);

export const button = createPeriodicTableButton(config, '🔁 Another Element');
