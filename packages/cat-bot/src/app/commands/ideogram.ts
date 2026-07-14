/**
 * /ideogram — Ideogram Text-to-Image Generator
 *
 * Generates an image from a text prompt via the Nexray "ideogram" endpoint.
 * The endpoint returns the rendered image directly (binary), not JSON, so
 * the response body is downloaded and forwarded as an attachment.
 *
 * Flow:
 *   User: /ideogram anime girl with short blue hair
 *   Bot:  [generated image + prompt caption]
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { withLoadingMedia } from '@/engine/utils/media-loading.util.js';

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchIdeogramImage(prompt: string): Promise<Buffer> {
  const url = createUrl('nexray', '/ai/ideogram', { prompt });
  const response = await fetch(url);

  if (!response.ok)
    throw new Error(`Ideogram API responded with status ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer.byteLength) throw new Error('Empty image returned');

  return Buffer.from(arrayBuffer);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Resolves the prompt from args, falling back to a quoted/replied message. */
function resolvePrompt(ctx: AppCtx): string {
  const fromArgs = ctx.args.join(' ').trim();
  if (fromArgs) return fromArgs;

  const messageReply = ctx.event['messageReply'] as
    | Record<string, unknown>
    | undefined;
  if (typeof messageReply?.['message'] === 'string')
    return (messageReply['message'] as string).trim();

  return '';
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'ideogram',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate an image from a text prompt using Ideogram.',
  category: 'AI Image',
  usage: '<prompt>',
  cooldown: 10,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { usage } = ctx;
  const prompt = resolvePrompt(ctx);

  if (!prompt) {
    await usage();
    return;
  }

  const loading = await withLoadingMedia(ctx, `🖼️ **Generating image for:** ${prompt}`);

  try {
    const image = await fetchIdeogramImage(prompt);
    await loading.finish({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **Prompt:** ${prompt}`,
      attachment: [{ name: 'ideogram.png', stream: image }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await loading.fail(`⚠️ Failed to generate the image: \`${error.message ?? 'Unknown error'}\``);
  }
};
