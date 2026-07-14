/**
 * /text2image — Ratio-Aware Text-to-Image Generator
 *
 * Generates an image from a text prompt via the Alwayscodex "text2image"
 * endpoint. An optional leading `W:H` aspect ratio token (e.g. "16:9") may be
 * supplied before the prompt; it defaults to "1:1" when omitted. The endpoint
 * returns the rendered image directly (binary), not JSON, so the response
 * body is downloaded and forwarded as an attachment.
 *
 * Flow:
 *   User: /text2image 16:9 anime girl with short blue hair
 *   Bot:  [generated image + prompt caption]
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { withLoadingMedia } from '@/engine/utils/media-loading.util.js';

const DEFAULT_RATIO = '1:1';

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchText2Image(prompt: string, ratio: string): Promise<Buffer> {
  const url = createUrl('alwayscodex', '/api/imageai/text2image', {
    teks: prompt,
    ratio,
  });
  const response = await fetch(url);

  if (!response.ok)
    throw new Error(`Text2Image API responded with status ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer.byteLength) throw new Error('Empty image returned');

  return Buffer.from(arrayBuffer);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** True when the token looks like a "W:H" aspect ratio, e.g. "16:9". */
function isRatioToken(value: string | undefined): value is string {
  return !!value && /^\d+:\d+$/.test(value);
}

/**
 * Resolves the aspect ratio and prompt from args, falling back to a
 * quoted/replied message for the prompt when no args are given.
 */
function resolveInput(ctx: AppCtx): { ratio: string; prompt: string } {
  const ratio = isRatioToken(ctx.args[0]) ? ctx.args[0] : DEFAULT_RATIO;
  const promptArgs = isRatioToken(ctx.args[0]) ? ctx.args.slice(1) : ctx.args;

  let prompt = promptArgs.join(' ').trim();

  if (!prompt) {
    const messageReply = ctx.event['messageReply'] as
      | Record<string, unknown>
      | undefined;
    if (typeof messageReply?.['message'] === 'string')
      prompt = (messageReply['message'] as string).trim();
  }

  return { ratio, prompt };
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'text2image',
  aliases: ['text2img', 'texttoimage', 'texttoimg'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate an image from a text prompt, with an optional aspect ratio.',
  category: 'AI Image',
  usage: '[ratio] <prompt>',
  cooldown: 10,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { usage } = ctx;
  const { ratio, prompt } = resolveInput(ctx);

  if (!prompt) {
    await usage();
    return;
  }

  const loading = await withLoadingMedia(ctx, `🖼️ **Generating image for:** ${prompt}`);

  try {
    const image = await fetchText2Image(prompt, ratio);
    await loading.finish({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **Prompt:** ${prompt}\n📐 **Ratio:** ${ratio}`,
      attachment: [{ name: 'text2image.png', stream: image }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await loading.fail(`⚠️ Failed to generate the image: \`${error.message ?? 'Unknown error'}\``);
  }
};
