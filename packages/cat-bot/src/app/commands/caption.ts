/**
 * /caption — overlay caption text on a photo.
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
  captionConfig,
  runPopcatMedia,
} from '@/engine/services/commands/popcat-media.service.js';

const config = captionConfig;

export const meta: CommandMeta = {
  name: 'caption',
  aliases: [],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Overlay caption text on a photo (attach, reply, or avatar).',
  category: 'image',
  usage: '<text>',
  cooldown: 8,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram],
  options: [
    {
      type: OptionType.string,
      name: 'text',
      description: 'Text to render (e.g. "Zero Two Caption")',
      required: true,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runPopcatMedia(ctx, config);
