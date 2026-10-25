/**
 * Popcat Search Service — shared implementation for JSON popcat search
 * endpoints.
 *
 * Each endpoint responds with `{ error: boolean, message: {...} | string }` — a
 * string `message` (or `error: true`) means "not found" rather than a hard
 * failure. Each config owns its response formatting and optional image URL.
 */

import axios from 'axios';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { createMessageDelivery } from './message-delivery.service.js';

interface SearchEnvelope<T> {
  error: boolean;
  message?: T | string;
}

interface SteamResult {
  type: string;
  name: string;
  thumbnail?: string;
  controller_support?: string;
  description: string;
  website?: string;
  banner?: string;
  developers?: string[];
  publishers?: string[];
  price?: string;
}

export interface SearchConfig<T> {
  name: string;
  path: string;
  label: string;
  emoji: string;
  /** Formats the endpoint-specific `message` object down to display text. */
  formatMessage: (message: T) => string;
  /** Optional image URL to attach alongside the formatted text. */
  getImageUrl?: (message: T) => string | undefined;
}

async function fetchSearchResult<T>(
  config: SearchConfig<T>,
  query: string,
): Promise<T> {
  const requestUrl = createUrl('popcat', config.path, { q: query });

  const { data } = await axios.get<SearchEnvelope<T>>(requestUrl, {
    timeout: 15_000,
    headers: { Accept: 'application/json' },
    validateStatus: () => true,
  });

  const { error, message } = data ?? { error: true, message: 'Empty response' };

  if (error || typeof message === 'string' || !message) {
    throw new Error(
      typeof message === 'string' ? message : `No results found for "${query}"`,
    );
  }

  return message;
}

/** Runs the shared search flow for a family config. */
export async function runSearch<T>(
  ctx: AppCtx,
  config: SearchConfig<T>,
): Promise<void> {
  const { args, usage } = ctx;

  const query = args.join(' ').trim();
  if (!query) {
    await usage();
    return;
  }

  const delivery = createMessageDelivery(ctx, { fallbackOnEditFailure: true });

  try {
    const result = await fetchSearchResult(config, query);
    const message = config.formatMessage(result);
    const imageUrl = config.getImageUrl?.(result);

    await delivery.deliver({
      style: MessageStyle.MARKDOWN,
      message,
      ...(imageUrl
        ? { attachment_url: [{ name: `${config.name}.png`, url: imageUrl }] }
        : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[popcat-search] ${config.name} failed: ${message}`);

    await delivery.fail(
      `⚠️ Failed to search ${config.label.toLowerCase()}: \`${message}\``,
    );
  }
}

export const steamSearchConfig: SearchConfig<SteamResult> = {
  name: 'steam',
  path: '/v2/steam',
  label: 'Steam Game',
  emoji: '🎮',
  formatMessage: (game: SteamResult) =>
    `🎮 **${game.name}** (${game.type})\n\n` +
    `${game.description || 'No description provided.'}\n\n` +
    `🕹️ **Controller Support:** ${game.controller_support || 'N/A'}\n` +
    `👨‍💻 **Developers:** ${game.developers?.join(', ') || 'N/A'}\n` +
    `🏢 **Publishers:** ${game.publishers?.join(', ') || 'N/A'}\n` +
    `💰 **Price:** ${game.price || 'N/A'}\n` +
    `🌐 **Website:** ${game.website || 'N/A'}`,
  getImageUrl: (game: SteamResult) => game.banner || game.thumbnail,
};
