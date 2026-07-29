/**
 * spotify.ts — Spotify Track Search & Downloader
 *
 * Searches Spotify by free-text query (title, artist, or "artist - title") and
 * delivers the top match as a playable MP3, forwarded via a direct download URL.
 *
 * API: GET https://api.nexray.eu.cc/downloader/spotifyplay?q=<query>
 *
 * Response shape:
 *   {
 *     status: boolean
 *     author: string
 *     result: {
 *       title: string
 *       artist: string
 *       duration: string       — e.g. "4:04"
 *       thumbnail: string
 *       popularity: number     — 0-100
 *       album: string
 *       release_at: string     — e.g. "2007-01-01"
 *       url: string            — open.spotify.com track link
 *       download_url: string   — direct, short-lived MP3 URL
 *     }
 *     timestamp: string
 *     response_time: string
 *   }
 *
 * Aliases: /sp, /spdl, /spotifydl
 * Access:  ANYONE
 * Cooldown: 10s
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { withRetry, isNetworkError } from '@/engine/lib/retry.lib.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

// ── API response type ────────────────────────────────────────────────────────

interface SpotifyPlayResult {
  title: string;
  artist: string;
  duration: string;
  thumbnail: string;
  popularity: number;
  album: string;
  release_at: string;
  url: string;
  download_url: string;
}

interface SpotifyPlayResponse {
  status?: boolean;
  message?: string;
  error?: string;
  result?: SpotifyPlayResult;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Per-request timeout for the Nexray search API. */
const REQUEST_TIMEOUT_MS = 20_000;

/** How long a successful search result is reused for an identical query. */
const RESPONSE_CACHE_TTL_MS = 3 * 60_000;

const NEXRAY_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Strips characters unsafe in filenames across all major OSes.
 * Truncates to 80 characters to avoid path-length limits.
 */
function safeFilename(label: string): string {
  return (
    label
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, '_')
      .trim()
      .substring(0, 80) + '.mp3'
  );
}

/**
 * Performs a cached, retrying search against the Nexray Spotify endpoint.
 * Identical queries within the cache window are served without a fresh
 * upstream call. Only transient failures (network errors, 429, 5xx) retry.
 *
 * @param query - Free-text search query.
 * @returns The top matching track.
 * @throws When no track is found, or the request ultimately fails.
 */
async function searchSpotify(query: string): Promise<SpotifyPlayResult> {
  const cacheKey = `spotify:${query.toLowerCase()}`;
  const cached = lruCache.get<SpotifyPlayResult>(cacheKey);
  if (cached !== undefined) return cached;

  const apiUrl = createUrl('nexray', '/downloader/spotifyplay', { q: query });

  const result = await withRetry(
    async () => {
      const res = await axios.get<SpotifyPlayResponse>(apiUrl, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: NEXRAY_HEADERS,
        validateStatus: (status) => status >= 200 && status < 500,
      });

      if (res.status >= 400) {
        const err = new Error(`Nexray API returned HTTP ${res.status}`) as Error & {
          status?: number;
        };
        err.status = res.status;
        throw err;
      }

      const body = res.data;
      if (body?.status === false) {
        throw new Error(
          body.message || body.error || 'The API reported that this search could not be processed.',
        );
      }

      if (!body?.result?.download_url) {
        throw new Error(`No Spotify track found for "${query}".`);
      }

      return body.result;
    },
    {
      maxAttempts: 3,
      initialDelayMs: 1_200,
      maxDelayMs: 6_000,
      shouldRetry: (err) => isNetworkError(err),
    },
  );

  lruCache.set(cacheKey, result, RESPONSE_CACHE_TTL_MS);
  return result;
}

/** Generous timeout for downloading the actual audio binary. */
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** Hard cap on the downloaded file — protects memory/bandwidth against runaway responses. */
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Downloads the track's MP3 bytes into a Buffer.
 *
 * Telegram's Bot API can accept a bare URL for sendAudio and fetch it server-side, but
 * this CDN (spotidown.app) rejects or mis-serves Telegram's own fetcher — surfacing as
 * "failed to get HTTP URL content". Downloading the bytes ourselves with a normal browser
 * UA and forwarding them as a real attachment sidesteps that unreliable remote-fetch path.
 *
 * @param url - Direct MP3 download URL.
 * @returns The downloaded audio buffer.
 * @throws When the download ultimately fails after retries.
 */
async function downloadTrack(url: string): Promise<Buffer> {
  return withRetry(
    async () => {
      const res = await axios.get<ArrayBuffer>(url, {
        timeout: DOWNLOAD_TIMEOUT_MS,
        headers: NEXRAY_HEADERS,
        responseType: 'arraybuffer',
        maxContentLength: MAX_DOWNLOAD_BYTES,
        maxBodyLength: MAX_DOWNLOAD_BYTES,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      const buf = Buffer.from(res.data);
      if (buf.length === 0) throw new Error('Downloaded audio file is empty.');
      return buf;
    },
    {
      maxAttempts: 3,
      initialDelayMs: 1_000,
      maxDelayMs: 5_000,
      shouldRetry: (err) => isNetworkError(err),
    },
  );
}

// ── Command configuration ────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'spotify',
  aliases: ['sp', 'spdl', 'spotifydl'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Search Spotify and download the top matching track as an MP3.',
  category: 'Downloader',
  usage: '<song title | artist - title>',
  cooldown: 10,
  hasPrefix: true,
};

// ── Command handler ──────────────────────────────────────────────────────────

export const onCommand = async ({ chat, args, usage }: AppCtx): Promise<void> => {
  if (args.length === 0) {
    await usage();
    return;
  }

  const query = args.join(' ').trim();

  try {
    const track = await searchSpotify(query);
    const audioBuffer = await downloadTrack(track.download_url);

    const caption = [
      `🎧  **${track.title}**`,
      `👤  **Artist**       ${track.artist}`,
      `💿  **Album**        ${track.album}`,
      `⏱️  **Duration**     ${track.duration}`,
      `📅  **Released**     ${track.release_at}`,
      `🔥  **Popularity**   ${track.popularity}/100`,
      `🔗  **Spotify**      ${track.url}`,
    ].join('\n');

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment: [
        {
          name: safeFilename(`${track.artist} - ${track.title}`),
          stream: audioBuffer,
        },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[spotify] search failed for "${query}": ${message}`);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Could not find or download that track: \`${message}\``,
    });
  }
};