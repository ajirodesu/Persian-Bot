/**
 * /gojo — Brat Gojo Canvas
 *
 * Generates a "brat album cover" style image with the given text via the
 * Alwayscodex canvas API. The endpoint returns the rendered image directly
 * (binary), not JSON, so the response body is forwarded as-is.
 *
 * Flow:
 *   User: /gojo Test
 *   Bot:  [brat-style image with the text "Test"]
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchBratGojo(text: string): Promise<Buffer> {
  const url = createUrl('alwayscodex', '/api/canvas/brat-gojo');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!response.ok)
    throw new Error(`Gojo canvas API responded with status ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer.byteLength) throw new Error('Empty image returned');

  return Buffer.from(arrayBuffer);
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'gojo',
  aliases: ['bratgojo'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate a brat-style Gojo image with custom text.',
  category: 'Canvas',
  usage: '<text>',
  cooldown: 10,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({ args, chat, usage }: AppCtx): Promise<void> => {
  if (!args.length) {
    await usage();
    return;
  }

  const text = args.join(' ').trim();

  try {
    const image = await fetchBratGojo(text);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `💚 **Brat Gojo** — ${text}`,
      attachment: [{ name: 'brat-gojo.png', stream: image }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to generate the image: \`${error.message ?? 'Unknown error'}\``,
    });
  }
};