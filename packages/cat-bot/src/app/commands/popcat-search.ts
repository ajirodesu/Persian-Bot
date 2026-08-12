/**
 * Popcat Search — multi-command family (single file, config-driven)
 *
 * Every entry hits a JSON api.popcat.xyz/v2/<endpoint>?q=<query> route and
 * looks up a single named result, responding with the shared envelope
 * `{ error: boolean, message: {...} | string }` — a string `message` (or
 * `error: true`) means "not found" rather than a hard failure. Since each
 * provider's `message` object has a completely different shape, one
 * SEARCH_CONFIGS table declares each provider's endpoint plus its own
 * formatMessage()/getImageUrl() formatting logic, and one shared
 * runSearch() handler dispatches on that config — adding another
 * api.popcat.xyz/v2/* search endpoint later means appending one config
 * object, no new onCommand function required.
 *
 * Commands:
 *   /steam — look up a Steam game/app by name       (aliases: steamsearch)
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand }>` and registers each entry
 * exactly like a standalone command module.
 *
 * Flow (per command):
 *   User: /steam minecraft
 *   Bot:  🎮 **minecraft** details (with optional image)
 */

import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// ── Shared response envelope ──────────────────────────────────────────────────
//
// Every api.popcat.xyz/v2/* search endpoint responds with the same shape:
//   { error: boolean, message: <endpoint-specific object> | string }
// A string `message` (or `error: true`) means "no result found".

interface SearchEnvelope<T> {
  error: boolean;
  message?: T | string;
}

// ── Per-provider response shapes ─────────────────────────────────────────────

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

// ── Config ────────────────────────────────────────────────────────────────────

interface SearchConfig<T = Record<string, unknown>> {
  name: string;
  aliases: string[];
  path: string;
  label: string;
  emoji: string;
  description: string;
  example: string;
  /** Formats the endpoint-specific `message` object down to display text. */
  formatMessage: (message: T) => string;
  /** Optional image URL to attach alongside the formatted text. */
  getImageUrl?: (message: T) => string | undefined;
}

const SEARCH_CONFIGS: SearchConfig<SteamResult>[] = [
  {
    name: 'steam',
    aliases: ['steamsearch'],
    path: '/v2/steam',
    label: 'Steam Game',
    emoji: '🎮',
    description: 'Look up a Steam game or app by name.',
    example: 'minecraft',
    formatMessage: (game: SteamResult) =>
      `🎮 **${game.name}** (${game.type})\n\n` +
      `${game.description || 'No description provided.'}\n\n` +
      `🕹️ **Controller Support:** ${game.controller_support || 'N/A'}\n` +
      `👨‍💻 **Developers:** ${game.developers?.join(', ') || 'N/A'}\n` +
      `🏢 **Publishers:** ${game.publishers?.join(', ') || 'N/A'}\n` +
      `💰 **Price:** ${game.price || 'N/A'}\n` +
      `🌐 **Website:** ${game.website || 'N/A'}`,
    getImageUrl: (game: SteamResult) => game.banner || game.thumbnail,
  },
];

// ── Shared fetcher ────────────────────────────────────────────────────────────

async function fetchSearchResult<T>(config: SearchConfig<T>, query: string): Promise<T> {
  const requestUrl = createUrl('popcat', config.path, { q: query });

  const { data } = await axios.get<SearchEnvelope<T>>(requestUrl, {
    timeout: 15_000,
    headers: { Accept: 'application/json' },
    validateStatus: () => true,
  });

  const { error, message } = data ?? { error: true, message: 'Empty response' };

  if (error || typeof message === 'string' || !message) {
    throw new Error(typeof message === 'string' ? message : `No results found for "${query}"`);
  }

  return message;
}

// ── Shared handler ────────────────────────────────────────────────────────────

async function runSearch<T>(ctx: AppCtx, config: SearchConfig<T>): Promise<void> {
  const { args, usage } = ctx;

  const query = args.join(' ').trim();
  if (!query) {
    await usage();
    return;
  }

  const isButtonAction = ctx.event['type'] === 'button_action';
  const loadingId = isButtonAction
    ? (ctx.event['messageID'] as string | undefined)
    : undefined;
  // Delivers the final result: edits the existing (button-bearing) message
  // in place on a button refresh, or sends a plain reply otherwise. No
  // loading placeholder is sent — the typing indicator covers processing
  // feedback for the whole command duration.
  const deliver = async (payload: ReplyOptions): Promise<void> => {
    if (!loadingId) {
      await ctx.chat.replyMessage(payload);
      return;
    }
    try {
      await ctx.chat.editMessage({ ...payload, message_id_to_edit: loadingId });
    } catch {
      await ctx.chat.unsendMessage(loadingId).catch(() => {});
      await ctx.chat.reply(payload);
    }
  };
  const finish = deliver;
  const fail = (errorMessage: string): Promise<void> =>
    deliver({ style: MessageStyle.MARKDOWN, message: errorMessage });

  try {
    const result = await fetchSearchResult(config, query);
    const message = config.formatMessage(result);
    const imageUrl = config.getImageUrl?.(result);

    await finish({
      style: MessageStyle.MARKDOWN,
      message,
      ...(imageUrl ? { attachment_url: [{ name: `${config.name}.png`, url: imageUrl }] } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[popcat-search] ${config.name} failed: ${message}`);

    await fail(`⚠️ Failed to search ${config.label.toLowerCase()}: \`${message}\``);
  }
}

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = SEARCH_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases,
    version: '1.0.0',
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: config.description,
    category: 'search',
    usage: '<query>',
    cooldown: 8,
    hasPrefix: true,
    options: [
      {
        type: OptionType.string,
        name: 'q',
        description: `Search query (e.g. "${config.example}")`,
        required: true,
      },
    ],
  },
  onCommand: async (ctx: AppCtx) => runSearch(ctx, config),
}));