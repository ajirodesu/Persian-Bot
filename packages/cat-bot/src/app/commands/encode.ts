/**
 * /encode — convert text with the Encode converter.
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
  name: 'encode',
  path: '/v2/encode',
  paramName: 'text',
  label: 'Encode',
  emoji: '🔐',
} satisfies ConverterConfig;

export const meta: CommandMeta = {
  name: 'encode',
  aliases: ['tobinary'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Convert text into binary code.',
  category: 'converter',
  usage: '<text>',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'text',
      description: 'Input to convert (e.g. "hello")',
      required: true,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runConverter(ctx, config);
