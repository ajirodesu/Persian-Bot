/**
 * /joke — get a random joke.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  createRandomTextButton,
  jokeConfig,
  runRandomTextFact,
} from '@/engine/services/commands/random-text-facts.service.js';

const config = jokeConfig;

export const meta: CommandMeta = {
  name: 'joke',
  aliases: ['telljoke', 'haha', 'funny'],
  version: '1.2.0',
  role: Role.ANYONE,
  author: 'JokeBotDev (ported to Cat-Bot)',
  description: 'Get a random joke to lighten the mood.',
  category: 'random',
  usage: '',
  cooldown: 3,
  hasPrefix: true,
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runRandomTextFact(ctx, config);

export const button = createRandomTextButton(config);
