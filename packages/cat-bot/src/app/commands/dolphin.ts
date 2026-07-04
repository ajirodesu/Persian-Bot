/**
 * /dolphin — Dolphin AI Chat
 *
 * Sends a prompt to the Neosoft "dolphin" AI endpoint and replies with its answer.
 *
 * Flow:
 *   User: /dolphin Explain quantum tunneling in one paragraph.
 *   Bot:  [AI-generated reply]
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DolphinResponse {
  status: boolean;
  creator?: string;
  model?: string;
  reply?: string;
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchDolphin(text: string): Promise<string> {
  const url = createUrl('neosoft', '/api/ai/dolphin', { text });
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Dolphin API responded with status ${response.status}`);

  const data = (await response.json()) as DolphinResponse;
  if (!data.status || !data.reply) throw new Error('Invalid response from Dolphin API');

  return data.reply;
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'dolphin',
  aliases: ['dolphinai'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Ask the Dolphin AI a question.',
  category: 'AI Chat',
  usage: '<prompt>',
  cooldown: 10,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({ args, chat, usage }: AppCtx): Promise<void> => {
  if (!args.length) {
    await usage();
    return;
  }

  const prompt = args.join(' ').trim();

  try {
    const reply = await fetchDolphin(prompt);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🐬 **Dolphin AI**\n\n${reply}`,
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to get a response from Dolphin AI: \`${error.message ?? 'Unknown error'}\``,
    });
  }
};