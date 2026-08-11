/**
 * humanizer.ts — /humanizer — AI Text Humanizer
 *
 * Rewrites AI-generated text into a more natural, human-sounding version via
 * the NexRay bypass endpoint.
 *
 * Flow:
 *   User: /humanizer Technology is incredibly important...
 *   Bot:  🧠 **Humanized** — Technology is important in today's world...
 *
 * Author: AjiroDesu
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';

// ── API contract ───────────────────────────────────────────────────────────

interface BypassResponse {
  status?: boolean;
  error?: string;
  result?: string;
}

const BYPASS_MAX_LENGTH = 2_000;

async function humanizeText(text: string): Promise<string> {
  const { data } = await axios.get<BypassResponse>(
    'https://api.nexray.eu.cc/ai/bypass',
    {
      params: { text },
      timeout: 30_000,
    },
  );

  if (!data.status || !data.result) throw new Error(data.error ?? 'Could not humanize text.');
  return data.result.trim();
}

// ── Config ──────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'humanizer',
  aliases: ['humanize', 'aihum'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Rewrites AI-generated text into a more natural, human-sounding version.',
  category: 'Utility',
  usage: '<text>',
  cooldown: 10,
  hasPrefix: true,
};

// ── Command Handler ─────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, args, usage } = ctx;

  if (!args.length) {
    await usage();
    return;
  }

  const text = args.join(' ').trim();

  if (text.length > BYPASS_MAX_LENGTH) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Text is too long. Please keep it under **${BYPASS_MAX_LENGTH.toLocaleString('en-US')} characters**.`,
    });
    return;
  }

  try {
    const humanized = await humanizeText(text);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🧠 **Humanized**\n\n${humanized}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to humanize the text: _${message}_`,
    });
  }
};