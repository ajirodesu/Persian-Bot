/**
 * /nasa — NASA Boarding Pass Canvas
 *
 * Generates a NASA-style boarding pass image with the given name via the
 * Alwayscodex canvas API. The endpoint returns the rendered image directly
 * (binary), not JSON, so the response body is forwarded as-is.
 *
 * Flow:
 *   User: /nasa Lance
 *   Bot:  [NASA boarding pass image for "Lance"]
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchNasaBoardingPass(name: string): Promise<Buffer> {
  const url = createUrl('alwayscodex', '/api/canvas/boarding-nasa');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });

  if (!response.ok)
    throw new Error(`NASA canvas API responded with status ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer.byteLength) throw new Error('Empty image returned');

  return Buffer.from(arrayBuffer);
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'nasa',
  aliases: ['boardingnasa'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'Cat-Bot',
  description: 'Generate a NASA-style boarding pass image with your name.',
  category: 'Canvas',
  usage: '<name>',
  cooldown: 10,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({ args, chat, usage }: AppCtx): Promise<void> => {
  if (!args.length) {
    await usage();
    return;
  }

  const name = args.join(' ').trim();

  try {
    const image = await fetchNasaBoardingPass(name);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🚀 **NASA Boarding Pass** — ${name}`,
      attachment: [{ name: 'nasa-boarding-pass.png', stream: image }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to generate the boarding pass: \`${error.message ?? 'Unknown error'}\``,
    });
  }
};