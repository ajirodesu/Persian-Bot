/**
 * /dogfact — get a random dog fact.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  createRandomTextButton,
  dogFactConfig,
  runRandomTextFact,
} from '@/engine/services/commands/random-text-facts.service.js';

const config = dogFactConfig;

export const meta: CommandMeta = {
  name: 'dogfact',
  aliases: ['df', 'dogfacts'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Get a random fun fact about dogs.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runRandomTextFact(ctx, config);

export const button = createRandomTextButton(config);
