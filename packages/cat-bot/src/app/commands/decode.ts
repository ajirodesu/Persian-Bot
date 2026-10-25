/**
 * /decode — convert text with the Decode converter.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  runConverter,
  type ConverterConfig,
} from '@/engine/services/commands/popcat-converter.service.js';

const config = {
  name: 'decode',
  path: '/v2/decode',
  paramName: 'binary',
  label: 'Decode',
  emoji: '🔓',
} satisfies ConverterConfig;

export const meta: CommandMeta = {
  name: 'decode',
  aliases: ['frombinary'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Convert binary code back into text.',
  category: 'converter',
  usage: '<binary>',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'binary',
      description:
        'Input to convert (e.g. "0110100001100101011011000110110001101111")',
      required: true,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runConverter(ctx, config);
