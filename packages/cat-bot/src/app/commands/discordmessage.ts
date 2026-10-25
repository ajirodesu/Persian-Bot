/**
 * /discordmessage — render a fake Discord message screenshot.
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
  discordMessageConfig,
  runPopcatMedia,
} from '@/engine/services/commands/popcat-media.service.js';

const config = discordMessageConfig;

export const meta: CommandMeta = {
  name: 'discordmessage',
  aliases: ['dmsg'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Render a fake Discord message screenshot. If only content is given (no "username | content" pair), your own display name is used as the username.',
  category: 'image',
  usage:
    '[username |] <content> [--avatar=<value>] [--color=<value>] [--timestamp=<value>]',
  cooldown: 8,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram],
  options: [
    {
      type: OptionType.string,
      name: 'username',
      description: 'Username value (defaults to your display name if omitted)',
      required: false,
    },
    {
      type: OptionType.string,
      name: 'content',
      description: 'Content value',
      required: true,
    },
    {
      type: OptionType.string,
      name: 'flags',
      description:
        'Optional: --avatar=<value>, --color=<value>, --timestamp=<value>',
      required: false,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runPopcatMedia(ctx, config);
