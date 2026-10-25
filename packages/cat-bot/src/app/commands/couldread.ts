/**
 * /couldread — render text with the Could Read effect.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  runPopcatText,
  type PopcatTextConfig,
} from '@/engine/services/commands/popcat-text.service.js';

const config = {
  name: 'couldread',
  path: '/v2/couldread',
  label: 'Could Read',
} satisfies PopcatTextConfig;

export const meta: CommandMeta = {
  name: 'couldread',
  aliases: [],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Render text as a "bet you could read that" meme.',
  category: 'image',
  usage: '<text> (or reply to a message)',
  cooldown: 8,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram],
  options: [
    {
      type: OptionType.string,
      name: 'text',
      description: 'Text to render (e.g. "Never Gonna Give You Up")',
      required: true,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runPopcatText(ctx, config);
