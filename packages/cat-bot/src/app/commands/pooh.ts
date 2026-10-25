/**
 * /pooh — render the regular Pooh / fancy Pooh meme.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  runPopcatMeme,
  type PopcatMemeConfig,
} from '@/engine/services/commands/popcat-meme.service.js';

const config = {
  name: 'pooh',
  path: '/v2/pooh',
  label: 'Pooh',
} satisfies PopcatMemeConfig;

export const meta: CommandMeta = {
  name: 'pooh',
  aliases: ['poohmeme'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Render the regular Pooh / fancy Pooh meme.',
  category: 'image',
  usage: '<text1> | <text2> (or reply for text2)',
  cooldown: 8,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'text1',
      description: 'First panel text (e.g. "making a discord bot")',
      required: true,
    },
    {
      type: OptionType.string,
      name: 'text2',
      description: 'Second panel text (e.g. "making an api")',
      required: true,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runPopcatMeme(ctx, config);
