/**
 * /jokeoverhead — apply the Joke Overhead avatar effect to a photo.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  runPopcatAvatar,
  type PopcatAvatarConfig,
} from '@/engine/services/commands/popcat-avatar.service.js';

const config = {
  name: 'jokeoverhead',
  path: '/v2/jokeoverhead',
  label: 'Joke Overhead',
} satisfies PopcatAvatarConfig;

export const meta: CommandMeta = {
  name: 'jokeoverhead',
  aliases: [],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Overlay the "joke went over their head" meme on a photo.',
  category: 'image',
  usage: [
    '(send a photo, reply to one, reply to a user, or leave blank to use your own avatar)',
  ],
  cooldown: 8,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runPopcatAvatar(ctx, config);
