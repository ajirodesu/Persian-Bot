/**
 * /video — download video from a YouTube URL or search query.
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
  runPlay,
  videoConfig,
} from '@/engine/services/commands/play.service.js';

const config = videoConfig;

export const meta: CommandMeta = {
  name: 'video',
  aliases: ['vid', 'mp4'],
  version: '3.1.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Download video from a YouTube URL or search query. Sends the top result as an MP4 file.',
  category: 'Media',
  usage: '<YouTube URL | search query>',
  cooldown: 15,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram],
  options: [
    {
      type: OptionType.string,
      name: 'query',
      description: 'YouTube URL or search query',
      required: true,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runPlay(ctx, config);
