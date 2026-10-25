/**
 * /wallpaper — get a random wallpaper, optionally by topic and size.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  createWallpaperButtons,
  parseWallpaperArgs,
  renderWallpaper,
} from '@/engine/services/commands/random-photos.service.js';

export const meta: CommandMeta = {
  name: 'wallpaper',
  aliases: ['wp', 'wall', 'background'],
  version: '1.5.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Get a random wallpaper (optionally specify size/topic).',
  category: 'random',
  usage: '[query] [WxH]',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { query, width, height } = parseWallpaperArgs(ctx.args);
  await renderWallpaper(ctx, query, width, height);
};

export const button = createWallpaperButtons();
