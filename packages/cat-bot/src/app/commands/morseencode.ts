/**
 * /morseencode — convert text into Morse code.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  morseEncodeConfig,
  runMorse,
} from '@/engine/services/commands/morse.service.js';

const config = morseEncodeConfig;

export const meta: CommandMeta = {
  name: 'morseencode',
  aliases: ['morseincode', 'tomorse', 'encodemorse'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Convert text into Morse code.',
  category: 'converter',
  usage: '<text>',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'text',
      description: 'Input to convert (e.g. "hello world")',
      required: true,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runMorse(ctx, config);
