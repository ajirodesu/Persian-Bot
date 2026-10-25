/**
 * /wyr — get a random "Would You Rather" question.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  createPromptButton,
  runPrompt,
  wyrConfig,
} from '@/engine/services/commands/popcat-random-text.service.js';

const config = wyrConfig;

export const meta: CommandMeta = {
  name: 'wyr',
  aliases: ['wouldyourather'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Get a random "Would You Rather" question.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runPrompt(ctx, config);

export const button = createPromptButton(config);
