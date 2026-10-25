/**
 * /animeme — send a random anime meme from r/animemes.
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
  endpoint: 'animemes',
  attachmentPrefix: 'animeme',
  titlePrefix: '',
} satisfies MemeConfig;

export const meta: CommandMeta = {
  name: 'animeme',
  aliases: ['anime-meme'],
  version: '1.2.0',
  role: Role.ANYONE,
  author: 'ShawnDesu',
  description: 'Fetch a random anime meme from Reddit.',
  category: 'Anime',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runMeme(ctx, config);

export const button = createMemeButton(config, '🔁 Refresh');
