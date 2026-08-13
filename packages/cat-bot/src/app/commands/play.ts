/**
 * /music and /video — YouTube Media Downloader (multi-command family)
 *
 * Accepts either a YouTube URL or a plain search query. When a URL is given,
 * it is passed directly to the API for extraction. When a search query is
 * given, the API resolves the top YouTube result automatically.
 *
 * API: https://yt-dlp-stream.onrender.com/api/v2/q?=<url|query>
 *
 * Response shape:
 *   {
 *     credit:   string   — API provider identifier ("MJL")
 *     version:  string   — API version string ("1.2.2")
 *     media: {
 *       mp4:  string     — direct MP4 video download URL
 *       mp3:  string     — direct MP3 audio download URL
 *     }
 *     ApiCount: number   — total requests served by this API instance
 *     ms:       number   — server-side processing time in milliseconds
 *   }
 *
 * ── Commands ──────────────────────────────────────────────────────────────
 *   /music  <url|query>  — downloads the MP3 audio  (aliases: play, song)
 *   /video  <url|query>  — downloads the MP4 video  (aliases: vid, mp4)
 *
 * Access:  ANYONE
 * Cooldown: 15s
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';

// ── API constants ──────────────────────────────────────────────────────────────

/** Fastest server index for the `ytdlp` provider — /api/v2/server=1/q. */
const API_ENDPOINT = '/api/v2/server=1/q';

/**
 * Maximum wait for the metadata + resolve step (ms).
 * Render.com free instances may cold-start for up to ~50s — 60s covers this.
 */
const SEARCH_TIMEOUT_MS = 60_000;

/**
 * Maximum wait for the media binary download step (ms).
 * URL-based requests take longer (~17s observed) than search queries (~1ms).
 * Must be generous enough for large audio/video files over cold connections.
 */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** How many times to retry a failed API call before giving up. */
const MAX_RETRIES = 2;

/** Base delay between retries in ms (doubles each attempt). */
const RETRY_BASE_DELAY_MS = 3_000;

// ── YouTube URL patterns ───────────────────────────────────────────────────────

/**
 * Matches all common YouTube URL formats and captures the video ID:
 *   - https://www.youtube.com/watch?v=VIDEO_ID
 *   - https://youtu.be/VIDEO_ID
 *   - https://www.youtube.com/shorts/VIDEO_ID
 *   - https://m.youtube.com/watch?v=VIDEO_ID
 */
const YT_URL_RE =
  /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

// ── API response type ──────────────────────────────────────────────────────────

interface YtDlpApiResponse {
  credit: string;   // "MJL"
  version: string;  // "1.2.2"
  media: {
    mp4: string;    // Direct MP4 download URL
    mp3: string;    // Direct MP3 download URL
  };
  ApiCount: number; // Lifetime request count for this API instance
  ms: number;       // Server-side processing time in milliseconds
}

// ── Command config types ───────────────────────────────────────────────────────

interface MediaCommandConfig {
  name: string;
  aliases: string[];
  description: string;
  format: 'mp3' | 'mp4';
  /** Which media key to read from the API response. */
  mediaKey: 'mp3' | 'mp4';
  /** Emoji used in the result caption. */
  emoji: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the YouTube video ID if the input is a recognisable YouTube URL,
 * otherwise returns null.
 */
function extractYouTubeId(input: string): string | null {
  return YT_URL_RE.exec(input)?.[1] ?? null;
}

/**
 * Strips characters unsafe in filenames across all major OSes.
 * Truncates to 80 characters to avoid path-length limits.
 */
function safeFilename(label: string, extension: 'mp3' | 'mp4'): string {
  return (
    label
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, '_')
      .trim()
      .substring(0, 80) + `.${extension}`
  );
}

/** 10535 → "10.5s" | 800 → "800ms" */
function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 2_097_152 → "2.0 MB" | 512_000 → "500 KB" */
function formatBytes(bytes: number): string {
  const kb = Math.round(bytes / 1024);
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

/**
 * Fetches a URL with automatic retries on network errors and 5xx responses.
 * Uses exponential backoff between attempts to avoid hammering cold-starting services.
 */
async function fetchWithRetry(
  url: string,
  timeoutMs: number,
  maxRetries = MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 3s, 6s, ...
      await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * attempt));
    }

    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      // Only retry on server errors (5xx) — 4xx errors are caller mistakes
      if (res.status >= 500 && attempt < maxRetries) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }

      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Don't retry on AbortError (timeout) — it will just time out again
      if ((err as { name?: string }).name === 'AbortError') throw err;
    }
  }

  throw lastError ?? new Error('Fetch failed after retries');
}

// ── Shared handler ─────────────────────────────────────────────────────────────

async function runMediaCommand(
  ctx: AppCtx,
  config: MediaCommandConfig,
): Promise<void> {
  const { chat, args, usage } = ctx;

  // ── Input validation ───────────────────────────────────────────────────────

  if (args.length === 0) {
    await usage();
    return;
  }

  const input = args.join(' ').trim();

  // ── Resolve input type ─────────────────────────────────────────────────────
  // If the input is a YouTube URL, extract its ID and pass the full URL to
  // the API. Otherwise treat the input as a plain search query.

  const videoId = extractYouTubeId(input);
  const isUrl = videoId !== null;

  /**
   * Human-readable label used in messages and the output filename.
   *   - URL input  → short ID form so the caption stays clean
   *   - Search     → the query as typed
   */
  const displayLabel = isUrl ? `youtu.be/${videoId}` : input;

  try {
    // ── Step 1: Resolve media URLs ─────────────────────────────────────────
    // The API uses a valueless query key: /api/v2/q?=<input>
    // Both plain search strings and full YouTube URLs are accepted as-is.
    // createUrl's empty param key produces the required `?=<value>` form.

    const apiUrl = createUrl('ytdlp', API_ENDPOINT, { '': input });

    const searchRes = await fetchWithRetry(apiUrl, SEARCH_TIMEOUT_MS);

    if (!searchRes.ok) {
      throw new Error(
        `Search API returned HTTP ${searchRes.status} — the service may be temporarily unavailable.`,
      );
    }

    const apiData = (await searchRes.json()) as YtDlpApiResponse;

    if (!apiData.media?.mp3 || !apiData.media?.mp4) {
      throw new Error(
        'No media URLs were returned. ' +
        (isUrl
          ? 'Ensure the video is public and not age-restricted.'
          : 'Try a different search term.'),
      );
    }

    const { mp3: mp3Url, mp4: mp4Url } = apiData.media;
    const serverMs = apiData.ms ?? 0;

    // ── Step 2: Download media binary ─────────────────────────────────────

    const mediaUrl = config.mediaKey === 'mp3' ? mp3Url : mp4Url;

    const mediaRes = await fetchWithRetry(mediaUrl, DOWNLOAD_TIMEOUT_MS);

    if (!mediaRes.ok) {
      throw new Error(
        `${config.format.toUpperCase()} download failed with HTTP ${mediaRes.status}. The link may have expired — try again.`,
      );
    }

    const mediaBuffer = Buffer.from(await mediaRes.arrayBuffer());

    if (mediaBuffer.length === 0) {
      throw new Error(
        `The downloaded ${config.format.toUpperCase()} file is empty. The source may no longer be available.`,
      );
    }

    // ── Step 3: Send result ────────────────────────────────────────────────

    const caption = [
      `${config.emoji}  **${displayLabel}**`,
      '',
      `📦  **File Size**     ${formatBytes(mediaBuffer.length)}`,
      `⚡  **API Response**  ${formatMs(serverMs)}`,
      `🎬  **Video**         ${mp4Url}`,
    ].join('\n');

    const resultPayload: ReplyOptions = {
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment: [
        {
          name: safeFilename(displayLabel, config.format),
          stream: mediaBuffer,
        },
      ],
    };

    await chat.replyMessage(resultPayload);
  } catch (err) {
    const error = err as { message?: string };

    const errPayload: ReplyOptions = {
      style: MessageStyle.MARKDOWN,
      message: [
        `❌  **Could not retrieve ${config.format.toUpperCase()} for** \`${displayLabel}\``,
        `\`${error.message ?? 'An unexpected error occurred.'}\``,
      ].join('\n'),
    };

    await chat.replyMessage(errPayload);
  }
}

// ── Command configurations ─────────────────────────────────────────────────────

const MEDIA_CONFIGS: MediaCommandConfig[] = [
  {
    name: 'music',
    aliases: ['play', 'song'],
    description:
      'Download audio from a YouTube URL or search query. Sends the top result as a playable MP3.',
    format: 'mp3',
    mediaKey: 'mp3',
    emoji: '🎵',
  },
  {
    name: 'video',
    aliases: ['vid', 'mp4'],
    description:
      'Download video from a YouTube URL or search query. Sends the top result as an MP4 file.',
    format: 'mp4',
    mediaKey: 'mp4',
    emoji: '🎬',
  },
];

// ── Command entry generation ───────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = MEDIA_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases,
    version: '3.1.0',
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: config.description,
    category: 'Media',
    usage: '<YouTube URL | search query>',
    cooldown: 15,
    hasPrefix: true,
    platform: [Platforms.Discord, Platforms.Telegram, Platforms.Fluxer],
    options: [
      {
        type: OptionType.string,
        name: 'query',
        description: 'YouTube URL or search query',
        required: true,
      },
    ],
  },
  onCommand: async (ctx: AppCtx) => runMediaCommand(ctx, config),
}));
