/**
 * /cat — send a random cat image.
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
  name: 'cat',
  label: 'Random Cat Image',
  emoji: '🐱',
  buttonLabel: '🔁 Another Cat',
  apiUrl: 'https://api.thecatapi.com/v1/images/search',
  apiParams: { mime_types: 'jpg,png,gif' },
  extractUrl: (data: unknown) =>
    (data as Array<{ url?: string }> | undefined)?.[0]?.url || null,
} satisfies AnimalConfig;

export const meta: CommandMeta = {
  name: 'cat',
  aliases: ['catpic', 'catimage', 'meow'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Send a random cat image.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runAnimalPhoto(ctx, config);

export const button = createAnimalButton(config);
