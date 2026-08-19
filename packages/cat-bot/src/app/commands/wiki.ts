/**
 * /wiki — Wikipedia Article Summary
 *
 * Looks up a Wikipedia article by title (or search query) and replies with
 * the page's short description, a trimmed summary extract, and a link to the
 * full article. When the exact title is missing, the query is searched via
 * Wikipedia's OpenSearch API and the closest match is used instead.
 *
 * Flow:
 *   User: /wiki JavaScript
 *   Bot:  📖 **JavaScript**
 *         High-level programming language...
 *         🔗 https://en.wikipedia.org/wiki/JavaScript
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WikiSummary {
  title?: string;
  description?: string;
  extract?: string;
  content_urls?: {
    desktop?: {
      page?: string;
    };
  };
}

/** OpenSearch returns [query, titles[], descriptions[], urls[]]. */
type OpenSearchResult = [string, string[], string[], string[]];

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchSummary(title: string): Promise<WikiSummary> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const { data } = await axios.get<WikiSummary>(url, {
    timeout: 10_000,
    headers: { 'User-Agent': 'Cat-Bot Wiki (contact: cat-bot)' },
  });
  return data;
}

/** Returns the best-matching article title for a query, or null. */
async function searchTitle(query: string): Promise<string | null> {
  const { data } = await axios.get<OpenSearchResult>(
    'https://en.wikipedia.org/w/api.php',
    {
      params: {
        action: 'opensearch',
        search: query,
        limit: 1,
        namespace: 0,
        format: 'json',
      },
      timeout: 10_000,
      headers: { 'User-Agent': 'Cat-Bot Wiki (contact: cat-bot)' },
    },
  );
  return data[1][0] ?? null;
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'wiki',
  aliases: ['wikipedia'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'Cat-Bot',
  description: 'Get a summary of a Wikipedia article.',
  category: 'Utility',
  usage: '<article title>',
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
    let summary: WikiSummary;

    // Try the query as an exact article title first.
    try {
      summary = await fetchSummary(query);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      // Anything other than "page not found" is a real failure — rethrow.
      if (status !== 404) throw err;

      // Exact title missing — search for the closest match and retry.
      const title = await searchTitle(query);
      if (!title) {
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: `No Wikipedia article found for **${query}**.`,
        });
        return;
      }
      summary = await fetchSummary(title);
    }

    const extract = summary.extract?.trim();
    if (!extract) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `No Wikipedia article found for **${query}**.`,
      });
      return;
    }

    // Keep the extract readable — cap it at ~600 characters.
    const snippet = extract.length > 600 ? `${extract.slice(0, 597)}...` : extract;
    const link =
      summary.content_urls?.desktop?.page ??
      `https://en.wikipedia.org/wiki/${encodeURIComponent(summary.title ?? query)}`;

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: [
        `📖 **${summary.title ?? query}**`,
        summary.description ? `_${summary.description}_` : '',
        '',
        snippet,
        '',
        `🔗 ${link}`,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  } catch (err) {
    const error = err as { message?: string };
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to fetch Wikipedia summary for **${query}**: \`${
        error.message ?? 'Unknown error'
      }\``,
    });
  }
};
