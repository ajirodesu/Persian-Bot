/**
 * poli.ts — /poli — Generate an image using Pollinations AI
 *
 * Port of canis's poli.ts: downloads the generated PNG from
 * https://image.pollinations.ai and sends it as an attachment.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

export const meta: CommandMeta = {
  name: 'poli',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu (ported from mrepol742/project-canis)',
  description: 'Generate an image using Pollinations AI.',
  category: 'ai',
  usage: '<prompt>',
  cooldown: 5,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram, Platforms.Fluxer],
};

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, args, usage } = ctx;
  const query = args.join(' ').trim();
  if (!query) {
    await usage();
    return;
  }

  try {
    const response = await axios.get<ArrayBuffer>(
      `https://image.pollinations.ai/prompt/${encodeURIComponent(query)}`,
      {
        responseType: 'arraybuffer',
        timeout: 60_000,
        maxContentLength: 15 * 1024 * 1024,
        maxBodyLength: 15 * 1024 * 1024,
        validateStatus: (status) => status >= 200 && status < 300,
      },
    );
    const buf = Buffer.from(response.data);
    if (buf.length === 0) throw new Error('Empty image response');

    await chat.replyMessage({
      style: MessageStyle.TEXT,
      message: `🎨 *${query}*`,
      attachment: [{ name: `poli_${Date.now()}.png`, stream: buf }],
    });
  } catch (err) {
    logger.warn('[poli] generation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    await chat.replyMessage({
      message:
        '⚠️ Failed to generate the image. Please try again with a different prompt.',
    });
  }
};
