/**
 * /meme — send a random meme from r/memes.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  createMemeButton,
  runMeme,
  type MemeConfig,
} from '@/engine/services/commands/meme.service.js';

const config = {
  endpoint: 'memes',
  attachmentPrefix: 'meme',
  titlePrefix: '😂 ',
} satisfies MemeConfig;

export const meta: CommandMeta = {
  name: 'meme',
  aliases: ['memes', 'randommeme'],
  version: '1.1.0',
  role: Role.ANYONE,
  author: 'ShawnDesu',
  description: 'Sends a random meme.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runMeme(ctx, config);

export const button = createMemeButton(config, '🔄 Next Meme');
