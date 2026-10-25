/**
 * /quote — get a random inspirational quote.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  createRandomTextButton,
  quoteConfig,
  runRandomTextFact,
} from '@/engine/services/commands/random-text-facts.service.js';

const config = quoteConfig;

export const meta: CommandMeta = {
  name: 'quote',
  aliases: ['inspire', 'motivation'],
  version: '1.1.0',
  role: Role.ANYONE,
  author: 'AjiroDesu (ported to Cat-Bot)',
  description: 'Get a random inspirational quote.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runRandomTextFact(ctx, config);

export const button = createRandomTextButton(config);
