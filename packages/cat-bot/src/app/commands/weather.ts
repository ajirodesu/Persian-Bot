/**
 * /weather — Current Weather Lookup
 *
 * Fetches a compact one-line weather summary for a given location from
 * wttr.in (`?format=4`). Handy for a team based in a tropical country to
 * quickly check whether it's hot out there.
 *
 * Flow:
 *   User: /weather Manila
 *   Bot:  🌦️ **Weather Update**
 *         📍 Manila: ☀️ +31°C
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchWeather(location: string): Promise<string> {
  const { data } = await axios.get<string>(
    `https://wttr.in/${encodeURIComponent(location)}`,
    {
      params: { format: '4' },
      timeout: 10000,
      responseType: 'text',
    },
  );

  const summary = data.trim();
  if (!summary) throw new Error('Empty response from weather service');

  return summary;
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'weather',
  aliases: ['wthr', 'temp'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Get the current weather for a given location.',
  category: 'Utility',
  usage: '<location>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, args, usage } = ctx;

  if (!args.length) {
    await usage();
    return;
  }

  const location = args.join(' ').trim();

  try {
    const summary = await fetchWeather(location);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🌦️ **Weather Update**\n📍 ${summary}`,
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to fetch the weather for **${location}**: \`${
        error.message ?? 'Unknown error'
      }\``,
    });
  }
};
