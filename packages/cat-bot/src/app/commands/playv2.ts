/**
 * play2.ts — playv2: Search-and-Play Audio (YouTube / Spotify)
 *
 * Cat-Bot port of a legacy `play` module that searches a source (YouTube or
 * Spotify) for a query, picks one result by index, and replies with the
 * playable audio. Registered as `playv2` (not `play`) because this repo
 * already has a `play.ts` command with different behaviour (direct YouTube
 * URL passthrough via a different API, no source/index flags) — see the
 * conversation this was converted from for the naming decision.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *   playv2 <query> [-i <index>] [-s <spotify|youtube>]
 *
 *   -i <number>   Which result index to use (default: 0)
 *   -s <text>     Source to search (available: spotify, youtube | default: youtube)
 *
 * Example:
 *   playv2 one last kiss - hikaru utada -i 8 -s spotify
 *
 * All user-facing text has been translated to English — the original
 * module's captions were in Indonesian ("Judul", "Artis").
 *
 * ── API (delirius provider, registered in apis.lib.ts) ──────────────────────
 *   Spotify: GET /search/spotify?q=<query>   → data[index]{ title, artist, url }
 *            GET /download/spotifydl?url=<>  → data.download (audio URL)
 *   YouTube: GET /search/ytsearch?q=<query>  → data[index]{ title, author.name, url }
 *            GET /download/ytmp3?url=<>      → data.download (audio URL)
 *
 * Note: the original module gated this behind `permissions: { coin: 10 }`.
 * That balance requirement has been intentionally dropped, matching the
 * same decision already made for the merged `download` command — playv2 is
 * free to use.
 *
 * Author: AjiroDesu
 */

import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// ── Meta ──────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'playv2',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Searches YouTube or Spotify for a song and replies with the playable audio.',
  category: 'Downloader',
  guide: [
    '<query> — Search and play the top result',
    '<query> -i <number> — Pick a specific result index (default: 0)',
    '<query> -s <spotify|youtube> — Choose the search source (default: youtube)',
  ],
  cooldown: 15,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram],
  options: [
    {
      type: OptionType.string,
      name: 'query',
      description:
        'Search text, plus optional -i <index> and -s <spotify|youtube> flags',
      required: true,
    },
  ],
};

// ── Request timeouts ─────────────────────────────────────────────────────────

const SEARCH_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 20_000;

// ── Flag parsing (-i <number>, -s <spotify|youtube>) ───────────────────────────
//
// Only the exact tokens "-i" / "-s" are treated as flags, so a query like
// "one last kiss - hikaru utada" (which contains a bare "-") is left intact.

type PlaySource = 'youtube' | 'spotify';

interface ParsedPlayArgs {
  input: string;
  index: number;
  source: PlaySource;
}

function parsePlayArgs(args: string[]): ParsedPlayArgs {
  const rest: string[] = [];
  let index = 0;
  let source: PlaySource = 'youtube';

  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    const lower = token.toLowerCase();

    // "-i=8" / "-s=spotify" — equals-sign form, value attached to the same token.
    const eqMatch = /^(-i|-s)=(.+)$/i.exec(token);
    if (eqMatch) {
      const [, flag, value] = eqMatch as unknown as [string, string, string];
      if (flag.toLowerCase() === '-i') {
        const parsed = parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed >= 0) index = parsed;
      } else {
        const normalized = value.toLowerCase();
        if (normalized === 'spotify' || normalized === 'youtube') source = normalized;
      }
      continue;
    }

    // "-i 8" / "-s spotify" — space-separated form, value is the next token.
    if (lower === '-i' && args[i + 1] !== undefined) {
      const parsed = parseInt(args[i + 1]!, 10);
      if (Number.isFinite(parsed) && parsed >= 0) index = parsed;
      i++;
      continue;
    }

    if (lower === '-s' && args[i + 1] !== undefined) {
      const value = args[i + 1]!.toLowerCase();
      if (value === 'spotify' || value === 'youtube') source = value;
      i++;
      continue;
    }

    rest.push(token);
  }

  return { input: rest.join(' ').trim(), index, source };
}

// ── Search + download resolution ────────────────────────────────────────────

interface ResolvedTrack {
  title: string;
  artist: string;
  url: string;
  download: string;
}

async function resolveSpotify(query: string, index: number): Promise<ResolvedTrack> {
  const searchApiUrl = createUrl('delirius', '/search/spotify', { q: query });
  const searchRes = await axios.get(searchApiUrl, { timeout: SEARCH_TIMEOUT_MS });
  const list = searchRes.data?.data as
    | Array<{ title?: string; artist?: string; url?: string }>
    | undefined;
  const item = list?.[index];
  if (!item?.url) {
    throw new Error(
      `No Spotify result found at index ${index}. Try a smaller index or a different search.`,
    );
  }

  const downloadApiUrl = createUrl('delirius', '/download/spotifydl', { url: item.url });
  const downloadRes = await axios.get(downloadApiUrl, { timeout: DOWNLOAD_TIMEOUT_MS });
  const download = downloadRes.data?.data?.download as string | undefined;
  if (!download) throw new Error('No downloadable audio was returned for this Spotify track.');

  return {
    title: item.title ?? 'Unknown title',
    artist: item.artist ?? 'Unknown artist',
    url: item.url,
    download,
  };
}

async function resolveYouTube(query: string, index: number): Promise<ResolvedTrack> {
  const searchApiUrl = createUrl('delirius', '/search/ytsearch', { q: query });
  const searchRes = await axios.get(searchApiUrl, { timeout: SEARCH_TIMEOUT_MS });
  const list = searchRes.data?.data as
    | Array<{ title?: string; author?: { name?: string }; url?: string }>
    | undefined;
  const item = list?.[index];
  if (!item?.url) {
    throw new Error(
      `No YouTube result found at index ${index}. Try a smaller index or a different search.`,
    );
  }

  const downloadApiUrl = createUrl('delirius', '/download/ytmp3', { url: item.url });
  const downloadRes = await axios.get(downloadApiUrl, { timeout: DOWNLOAD_TIMEOUT_MS });
  const download = downloadRes.data?.data?.download as string | undefined;
  if (!download) throw new Error('No downloadable audio was returned for this YouTube video.');

  return {
    title: item.title ?? 'Unknown title',
    artist: item.author?.name ?? 'Unknown artist',
    url: item.url,
    download,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strips characters unsafe in filenames across all major OSes. */
function safeFilename(label: string): string {
  return (
    label
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, '_')
      .trim()
      .substring(0, 80) + '.mp3'
  );
}

function buildInstructions(prefix: string): string {
  return [
    '🎵 **Search for a song to play.**',
    '',
    `» \`${prefix}playv2 one last kiss - hikaru utada -i 8 -s spotify\``,
    '',
    '**Flags:**',
    '`-i <number>` — Select which result index to use (default: 0)',
    '`-s <text>` — Source to search (available: spotify, youtube | default: youtube)',
  ].join('\n');
}

// ── onCommand ─────────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, args, prefix } = ctx;
  const { input, index, source } = parsePlayArgs(args);

  if (!input) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: buildInstructions(prefix || '/'),
    });
    return;
  }

  const sourceLabel = source === 'spotify' ? 'Spotify' : 'YouTube';
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
    const track =
      source === 'spotify'
        ? await resolveSpotify(input, index)
        : await resolveYouTube(input, index);

    const caption = [
      `❖ **Title**: ${track.title}`,
      `❖ **Artist**: ${track.artist}`,
      `❖ **URL**: ${track.url}`,
    ].join('\n');

    await finish({
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment_url: [{ name: safeFilename(track.title), url: track.download }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[playv2] ${source} search failed: ${message}`);
    await fail(`⚠️ Failed to fetch audio: \`${message}\``);
  }
};