/**
 * /lizard — send a random lizard image.
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
  name: 'lizard',
  label: 'Random Lizard Image',
  emoji: '🦎',
  buttonLabel: '🔁 Another Lizard',
  apiUrl: 'https://nekos.life/api/v2/img/lizard',
  extractUrl: (data: unknown) =>
    (data as { url?: string } | undefined)?.url || null,
} satisfies AnimalConfig;

export const meta: CommandMeta = {
  name: 'lizard',
  aliases: ['lizardpic', 'lizardimage', 'gecko'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Send a random lizard image.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runAnimalPhoto(ctx, config);

export const button = createAnimalButton(config);
