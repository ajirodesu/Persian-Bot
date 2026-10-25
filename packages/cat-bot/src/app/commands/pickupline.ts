/**
 * /pickupline — get a random pickup line.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  createPromptButton,
  pickupLineConfig,
  runPrompt,
} from '@/engine/services/commands/popcat-random-text.service.js';

const config = pickupLineConfig;

export const meta: CommandMeta = {
  name: 'pickupline',
  aliases: ['pickuplines', 'pickup'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Get a random pickup line.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runPrompt(ctx, config);

export const button = createPromptButton(config);
