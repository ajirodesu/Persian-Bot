/**
 * /8ball — ask the magic 8-ball a question.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  createPromptButton,
  eightBallConfig,
  runPrompt,
} from '@/engine/services/commands/popcat-random-text.service.js';

const config = eightBallConfig;

export const meta: CommandMeta = {
  name: '8ball',
  aliases: ['eightball', 'ball'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Ask the magic 8-ball a yes/no question (or just roll one blind).',
  category: 'random',
  usage: '[question]',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'question',
      description: 'Optional input for Magic 8-Ball',
      required: false,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runPrompt(ctx, config);

export const button = createPromptButton(config);
