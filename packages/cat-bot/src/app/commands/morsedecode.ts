/**
 * /morsedecode — convert Morse code back into text.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  morseDecodeConfig,
  runMorse,
} from '@/engine/services/commands/morse.service.js';

const config = morseDecodeConfig;

export const meta: CommandMeta = {
  name: 'morsedecode',
  aliases: ['frommorse', 'decodemorse'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Convert Morse code back into text.',
  category: 'converter',
  usage: '<morse>',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'morse',
      description:
        'Input to convert (e.g. ".... . .-.. .-.. --- / .-- --- .-. .-.. -..")',
      required: true,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runMorse(ctx, config);
