/**
 * /qr — QR Code Generator
 *
 * Generates a QR code image for the given text/URL via the Delirius canvas API.
 * The endpoint returns the rendered image directly (binary), not JSON.
 *
 * Flow:
 *   User: /qr https://www.delirius.store/
 *   Bot:  [QR code image]
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { withLoadingMedia } from '@/engine/utils/media-loading.util.js';

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchQrCode(text: string): Promise<Buffer> {
  const url = createUrl('delirius', '/canvas/createqr', { text });
  const response = await fetch(url);

  if (!response.ok)
    throw new Error(`QR API responded with status ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer.byteLength) throw new Error('Empty image returned');

  return Buffer.from(arrayBuffer);
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'qr',
  aliases: ['qrcode'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate a QR code image from text or a URL.',
  category: 'Canvas',
  usage: '<text or url>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { args, usage } = ctx;
  if (!args.length) {
    await usage();
    return;
  }

  const text = args.join(' ').trim();

  const loading = await withLoadingMedia(ctx, '🔳 **Generating QR code...**');

  try {
    const image = await fetchQrCode(text);
    await loading.finish({
      style: MessageStyle.MARKDOWN,
      message: `🔳 **QR Code**\n📝 ${text}`,
      attachment: [{ name: 'qrcode.png', stream: image }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await loading.fail(`⚠️ Failed to generate the QR code: \`${error.message ?? 'Unknown error'}\``);
  }
};