/**
 * /coffee — send a random coffee image.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  coffeePhotoConfig,
  createSimplePhotoButton,
  runSimplePhoto,
} from '@/engine/services/commands/random-photos.service.js';

const config = coffeePhotoConfig;

export const meta: CommandMeta = {
  name: 'coffee',
  aliases: ['coffeepic', 'coffeeimage', 'brew'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Send a random coffee image.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runSimplePhoto(ctx, config);

export const button = createSimplePhotoButton(config);
