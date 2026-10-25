/**
 * /fox — send a random fox image.
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
  name: 'fox',
  label: 'Random Fox Image',
  emoji: '🦊',
  buttonLabel: '🔁 Floof Again',
  apiUrl: 'https://randomfox.ca/floof/',
  extractUrl: (data: unknown) =>
    (data as { image?: string } | undefined)?.image || null,
} satisfies AnimalConfig;

export const meta: CommandMeta = {
  name: 'fox',
  aliases: ['foxpic', 'foximage', 'floof'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Send a random fox image.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runAnimalPhoto(ctx, config);

export const button = createAnimalButton(config);
