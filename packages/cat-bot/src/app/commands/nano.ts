/**
 * nano.ts — /nano — Create a picture using the Gemini nano-banana model
 *
 * Port of canis's nano.ts: generates an image with
 * gemini-2.5-flash-image-preview and sends the result as an attachment.
 * Requires a Gemini API key saved in the dashboard (AI Integration) — no env
 * vars: the user's stored Gemini key is used whether or not Gemini is their
 * active provider.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { getGeminiClient } from '@/engine/agent/lib/agent-providers.lib.js';
import { resolveStoredApiKey } from '@/engine/agent/lib/agent-config.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

const NANO_MODEL = 'gemini-2.5-flash-image-preview';

export const meta: CommandMeta = {
  name: 'nano',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu (ported from mrepol742/project-canis)',
  description: 'Create a picture using the nano banana model.',
  category: 'ai',
  usage: '<prompt>',
  cooldown: 5,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram, Platforms.Fluxer],
};

/** Gemini key from the user's dashboard config — no env fallback. */
async function resolveGeminiKey(ctx: AppCtx): Promise<string | undefined> {
  return resolveStoredApiKey(ctx.native.userId, 'gemini');
}

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, args, usage } = ctx;
  const query = args.join(' ').trim();
  if (!query) {
    await usage();
    return;
  }

  const apiKey = await resolveGeminiKey(ctx);
  if (!apiKey) {
    await chat.replyMessage({
      message:
        '⚠️ Gemini is not configured. Add a Gemini API key in the dashboard (Settings → AI Integration) to use /nano.',
    });
    return;
  }

  try {
    const response = await getGeminiClient(apiKey).models.generateContent({
      model: NANO_MODEL,
      contents: [{ role: 'user', parts: [{ text: query }] }],
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
      await chat.replyMessage({
        message: 'No image was generated. Try a different prompt.',
      });
      return;
    }

    for (const part of candidate.content.parts) {
      if (part.text) {
        await chat.replyMessage({ message: part.text });
      } else if (part.inlineData?.data) {
        const buffer = Buffer.from(part.inlineData.data, 'base64');
        await chat.replyMessage({
          style: MessageStyle.TEXT,
          message: `🎨 *${query}*`,
          attachment: [{ name: `nano_${Date.now()}.png`, stream: buffer }],
        });
      }
    }
  } catch (err) {
    logger.warn('[nano] generation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    await chat.replyMessage({
      message:
        '⚠️ Failed to generate the image. Please try again with a different prompt.',
    });
  }
};
