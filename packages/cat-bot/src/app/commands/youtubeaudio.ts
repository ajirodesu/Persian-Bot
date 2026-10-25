/**
 * /youtubeaudio — download a YouTube video as MP3 audio.
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
  runYtDownload,
  youtubeAudioConfig,
} from '@/engine/services/commands/youtube-download.service.js';

const config = youtubeAudioConfig;

export const meta: CommandMeta = {
  name: 'youtubeaudio',
  aliases: ['yta', 'ytaudio', 'ytmp3'],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Downloads a YouTube video as MP3 audio.',
  category: 'Downloader',
  usage: '<YouTube URL> [-d]',
  cooldown: 10,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram],
  options: [
    {
      type: OptionType.string,
      name: 'url',
      description: 'YouTube link, plus optional -d flag',
      required: true,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runYtDownload(ctx, config);
