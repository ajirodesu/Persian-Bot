/**
 * ai-image.ts — Text-to-image AI command family (config-driven)
 *
 * Ports the `commands/ai/flux.js` and `commands/ai/pollinations.js` commands
 * to Cat-Bot's TypeScript multi-command shape. Both hit Alwayscodex image
 * endpoints that render the image and serve it back — the result URL is
 * forwarded directly via `attachment_url` (same convention as text2image.ts),
 * so the bot never downloads the bytes.
 *
 * Commands:
 *   /flux <prompt>          — Flux text-to-image (aliases: none)
 *   /pollinations <prompt>  — Pollinations text-to-image (aliases: none)
 *
 * Flow:
 *   User: /flux anime girl with short blue hair
 *   Bot:  [generated image + prompt caption]
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';

// ── Config ────────────────────────────────────────────────────────────────────

interface AiImageConfig {
  name: string;
  aliases: string[];
  description: string;
  example: string;
  endpoint: string;
  textParam: string;
  filename: string;
}

const AI_IMAGE_CONFIGS: AiImageConfig[] = [
  {
    name: 'flux',
    aliases: [] as string[],
    description: 'Generate an image from a text prompt using Flux.',
    example: 'anime girl with short blue hair',
    endpoint: '/api/imageai/text2imgv2',
    textParam: 'teks',
    filename: 'flux.png',
  },
  {
    name: 'pollinations',
    aliases: [] as string[],
    description: 'Generate an image from a text prompt using Pollinations.',
    example: 'anime girl with short blue hair',
    endpoint: '/api/imageai/pollinations',
    textParam: 'prompt',
    filename: 'pollinations.png',
  },
];

// ── Shared handler ─────────────────────────────────────────────────────────────

async function runAiImage(ctx: AppCtx, cfg: AiImageConfig): Promise<void> {
  const { usage } = ctx;

  const fromArgs = ctx.args.join(' ').trim();
  const messageReply = ctx.event['messageReply'] as
    | Record<string, unknown>
    | undefined;
  const fromQuoted = (messageReply?.['message'] as string | undefined) ?? '';

  const prompt = fromArgs || fromQuoted.trim();
  if (!prompt) {
    await usage();
    return;
  }

  try {
    const url = createUrl('alwayscodex', cfg.endpoint, {
      [cfg.textParam]: prompt,
    });

    await ctx.chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **Prompt:** ${prompt}`,
      attachment_url: [{ name: cfg.filename, url }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await ctx.chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to generate the image: \`${error.message ?? 'Unknown error'}\``,
    });
  }
}

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = AI_IMAGE_CONFIGS.map((cfg) => ({
  meta: {
    name: cfg.name,
    aliases: cfg.aliases,
    version: '1.0.0',
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: cfg.description,
    category: 'AI Image',
    usage: '<prompt>',
    cooldown: 10,
    hasPrefix: true,
    payment: 10,
    options: [
      {
        type: OptionType.string,
        name: 'prompt',
        description: `Image prompt (e.g. "${cfg.example}")`,
        required: false,
      },
    ],
  },
  onCommand: async (ctx: AppCtx) => runAiImage(ctx, cfg),
}));