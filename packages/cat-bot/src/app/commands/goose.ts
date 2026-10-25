/**
 * /goose — send a random goose image.
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
  name: 'goose',
  label: 'Random Goose Image',
  emoji: '🪿',
  buttonLabel: '🔁 Another Goose',
  apiUrl: 'https://nekos.life/api/v2/img/goose',
  extractUrl: (data: unknown) =>
    (data as { url?: string } | undefined)?.url || null,
} satisfies AnimalConfig;

export const meta: CommandMeta = {
  name: 'goose',
  aliases: ['goosepic', 'gooseimage', 'honk'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Send a random goose image.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runAnimalPhoto(ctx, config);

export const button = createAnimalButton(config);
