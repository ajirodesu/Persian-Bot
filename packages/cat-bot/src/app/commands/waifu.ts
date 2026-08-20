/**
 * /waifu — Random Waifu Image
 *
 * Fetches a random waifu image from the Nexray anime API. The endpoint
 * returns the image directly (binary), not JSON, so the response body is
 * forwarded as-is and sent as an image attachment.
 *
 * Flow:
 *   User: /waifu
 *   Bot:  [random waifu image]
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';

// ── Fetcher ───────────────────────────────────────────────────────────────────

/** Maps a response content-type header to a safe file extension. */
function extFromContentType(contentType: string | null): string {
  if (!contentType) return 'jpg';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('avif')) return 'avif';
  return 'jpg';
}

async function fetchWaifu(): Promise<{ buffer: Buffer; ext: string }> {
  const url = createUrl('nexray', '/random/anime', { type: 'waifu' });

  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Nexray anime API responded with status ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer.byteLength) throw new Error('Empty image returned');

  const ext = extFromContentType(response.headers.get('content-type'));
  return { buffer: Buffer.from(arrayBuffer), ext };
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'waifu',
  aliases: ['waifus'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'Winter Lance',
  description: 'Send a random waifu image.',
  category: 'anime',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const fail = (errorMessage: string) =>
    ctx.chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: errorMessage,
    });

  try {
    const { buffer, ext } = await fetchWaifu();
    await ctx.chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '💕 **Here\'s your waifu!**',
      attachment: [{ name: `waifu.${ext}`, stream: buffer }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await fail(
      `⚠️ Failed to fetch a waifu: \`${error.message ?? 'Unknown error'}\``,
    );
  }
};
