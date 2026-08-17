/**
 * /duckduckgo — DuckDuckGo Instant Answer Search
 *
 * Port of project-canis's `duckduckgo` command (mrepol742/project-canis),
 * adapted to Cat-Bot's module conventions. Queries DuckDuckGo's Instant
 * Answer API (api.duckduckgo.com) directly and replies with the abstract
 * summary when one exists, otherwise the first related topic, otherwise a
 * search link as a fallback.
 *
 * Flow:
 *   User: /duckduckgo tallest building in the world
 *   Bot:  Burj Khalifa is the tallest building in the world...
 *         https://en.wikipedia.org/wiki/Burj_Khalifa
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DuckDuckGoTopic {
  Text?: string;
  FirstURL?: string;
}

interface DuckDuckGoResponse {
  AbstractText?: string;
  AbstractURL?: string;
  RelatedTopics?: Array<DuckDuckGoTopic | { Topics?: DuckDuckGoTopic[] }>;
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchInstantAnswer(query: string): Promise<DuckDuckGoResponse> {
  // Endpoint is used directly (not via the apis.lib.ts registry).
  const url =
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}` +
    `&format=json&no_html=1&no_redirect=1&pretty=1`;

  const { data } = await axios.get<DuckDuckGoResponse>(url, {
    timeout: 10_000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Cat-Bot DuckDuckGo)' },
  });
  return data;
}

/**
 * Formats the first usable answer from an Instant Answer response: the
 * abstract summary, else the first related topic that has text + a link.
 * Returns null when the API has no answer for the query.
 */
export function formatAnswer(data: DuckDuckGoResponse): string | null {
  if (data.AbstractText) {
    return data.AbstractURL
      ? `${data.AbstractText}\n\n${data.AbstractURL}`
      : data.AbstractText;
  }

  if (Array.isArray(data.RelatedTopics)) {
    for (const topic of data.RelatedTopics) {
      // Topic objects carry Text/FirstURL; category objects nest them under
      // Topics[] — cast explicitly since the optional `Topics` key defeats
      // `in`-narrowing on the union.
      const t: DuckDuckGoTopic | undefined =
        'Topics' in topic
          ? (topic as { Topics?: DuckDuckGoTopic[] }).Topics?.[0]
          : (topic as DuckDuckGoTopic);
      if (t?.Text && t.FirstURL) {
        return `${t.Text}\n${t.FirstURL}`;
      }
    }
  }

  return null;
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'duckduckgo',
  aliases: ['ddg'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'Cat-Bot',
  description: 'Search with DuckDuckGo and get an instant answer.',
  category: 'search',
  usage: '<query>',
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

  const query = args.join(' ').trim();

  try {
    const data = await fetchInstantAnswer(query);
    const answer = formatAnswer(data);

    if (answer) {
      await chat.replyMessage({ style: MessageStyle.TEXT, message: answer });
      return;
    }

    // No instant answer — hand the user a ready-to-open search link.
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
    await chat.replyMessage({
      style: MessageStyle.TEXT,
      message: `No instant answer found for "${query}". Try the link:\n${searchUrl}`,
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.TEXT,
      message: `⚠️ Failed to search DuckDuckGo: \`${error.message ?? 'Unknown error'}\``,
    });
  }
};
