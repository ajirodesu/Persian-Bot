/**
 * /ba — send a random Blue Archive image.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  blueArchivePhotoConfig,
  createSimplePhotoButton,
  runSimplePhoto,
} from '@/engine/services/commands/random-photos.service.js';

const config = blueArchivePhotoConfig;

export const meta: CommandMeta = {
  name: 'ba',
  aliases: ['bluearchive'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Fetches a random Blue Archive image.',
  category: 'anime',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runSimplePhoto(ctx, config);

export const button = createSimplePhotoButton(config);
