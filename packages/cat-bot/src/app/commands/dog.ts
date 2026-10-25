/**
 * /dog — send a random dog image.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  createAnimalButton,
  runAnimalPhoto,
  type AnimalConfig,
} from '@/engine/services/commands/animal-photos.service.js';

const config = {
  name: 'dog',
  label: 'Random Dog Image',
  emoji: '🐶',
  buttonLabel: '🔁 Another Dog',
  apiUrl: 'https://dog.ceo/api/breeds/image/random',
  extractUrl: (data: unknown) =>
    (data as { message?: string } | undefined)?.message || null,
} satisfies AnimalConfig;

export const meta: CommandMeta = {
  name: 'dog',
  aliases: ['dogpic', 'dogimage', 'woof'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Send a random dog image.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runAnimalPhoto(ctx, config);

export const button = createAnimalButton(config);
