/**
 * Play Service — shared implementation for /music and /video.
 *
 * Accepts either a YouTube URL or a plain search query. When a URL is given it
 * is passed directly to the API; otherwise the API resolves the top YouTube
 * result automatically. Both commands differ only in which media key they read
 * from the response and the caption emoji/format.
 */

import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

const API_ENDPOINT = '/api/v2/server=1/q';
const SEARCH_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 3_000;

const YT_URL_RE =
  /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

interface YtDlpApiResponse {
  credit: string;
  version: string;
  media: {
    mp4: string;
    mp3: string;
  };
  ApiCount: number;
  ms: number;
}

export interface MediaCommandConfig {
  name: string;
  format: 'mp3' | 'mp4';
  /** Which media key to read from the API response. */
  mediaKey: 'mp3' | 'mp4';
  /** Emoji used in the result caption. */
  emoji: string;
}

function extractYouTubeId(input: string): string | null {
  return YT_URL_RE.exec(input)?.[1] ?? null;
}

function safeFilename(label: string, extension: 'mp3' | 'mp4'): string {
  return (
    label
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, '_')
      .trim()
      .substring(0, 80) + `.${extension}`
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatBytes(bytes: number): string {
  const kb = Math.round(bytes / 1024);
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

async function fetchWithRetry(
  url: string,
  timeoutMs: number,
  maxRetries = MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_BASE_DELAY_MS * attempt),
      );
    }

    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.status >= 500 && attempt < maxRetries) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }

      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if ((err as { name?: string }).name === 'AbortError') throw err;
    }
  }

  throw lastError ?? new Error('Fetch failed after retries');
}

/** Runs the shared YouTube media download flow for a family config. */
export async function runPlay(
  ctx: AppCtx,
  config: MediaCommandConfig,
): Promise<void> {
  const { chat, args, usage } = ctx;

  if (args.length === 0) {
    await usage();
    return;
  }

  const input = args.join(' ').trim();

  const videoId = extractYouTubeId(input);
  const isUrl = videoId !== null;
  const displayLabel = isUrl ? `youtu.be/${videoId}` : input;

  try {
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

export const musicConfig: MediaCommandConfig = {
  name: 'music',
  format: 'mp3',
  mediaKey: 'mp3',
  emoji: '🎵',
};

export const videoConfig: MediaCommandConfig = {
  name: 'video',
  format: 'mp4',
  mediaKey: 'mp4',
  emoji: '🎬',
};
