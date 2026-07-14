/**
 * /play — YouTube Audio Search and Streamer
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
 * Aliases: /song, /music
 * Access:  ANYONE
 * Cooldown: 15s
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

// ── API constants ──────────────────────────────────────────────────────────────

const API_BASE = 'https://yt-dlp-stream.onrender.com/api/v2/q';

/**
 * Maximum wait for the metadata + resolve step (ms).
 * Render.com free instances may cold-start for up to ~50s — 60s covers this.
 */
const SEARCH_TIMEOUT_MS = 60_000;

/**
 * Maximum wait for the audio binary download step (ms).
 * URL-based requests take longer (~17s observed) than search queries (~1ms).
 * Must be generous enough for large audio files over cold connections.
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
function safeFilename(label: string): string {
  return (
    label
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, '_')
      .trim()
      .substring(0, 80) + '.mp3'
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

// ── Command configuration ──────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'play',
  aliases: ['song', 'music'] as string[],
  version: '3.1.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Play audio from a YouTube URL or search query. Sends the top result as a playable MP3.',
  category: 'Media',
  usage: '<YouTube URL | search query>',
  cooldown: 15,
  hasPrefix: true,
};

// ── Command handler ────────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  args,
  usage,
}: AppCtx): Promise<void> => {
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

  // ── Loading indicator ──────────────────────────────────────────────────────

  const loadingId = (await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: isUrl
      ? `🔗  Fetching audio from **${displayLabel}**...`
      : `🔍  Searching for **${displayLabel}**...`,
  })) as string | undefined;

  // Cleans up the loading message; never throws.
  const dismissLoading = (): Promise<void> =>
    loadingId
      ? chat.unsendMessage(loadingId).catch(() => {})
      : Promise.resolve();

  // Edits the loading message (for progress updates).
  const updateLoading = (msg: string): Promise<void> => {
    if (!loadingId) return Promise.resolve();
    return chat
      .editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: loadingId,
        message: msg,
      })
      .catch(() => {});
  };

  try {
    // ── Step 1: Resolve media URLs ─────────────────────────────────────────
    // The API uses a valueless query key: /api/v2/q?=<input>
    // Both plain search strings and full YouTube URLs are accepted as-is.

    const apiUrl = `${API_BASE}?=${encodeURIComponent(input)}`;

    const searchRes = await fetchWithRetry(apiUrl, SEARCH_TIMEOUT_MS).catch(
      async (err) => {
        // If first attempt takes a while, inform user the server is warming up
        await updateLoading(
          `⏳  Server is warming up, please wait for **${displayLabel}**...`,
        );
        throw err;
      },
    );

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

    // ── Step 2: Download audio binary ─────────────────────────────────────

    await updateLoading(`⬇️  Downloading audio for **${displayLabel}**...`);

    const audioRes = await fetchWithRetry(mp3Url, DOWNLOAD_TIMEOUT_MS);

    if (!audioRes.ok) {
      throw new Error(
        `Audio download failed with HTTP ${audioRes.status}. The link may have expired — try again.`,
      );
    }

    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    if (audioBuffer.length === 0) {
      throw new Error(
        'The downloaded audio file is empty. The source may no longer be available.',
      );
    }

    // ── Step 3: Send result ────────────────────────────────────────────────

    const caption = [
      `🎵  **${displayLabel}**`,
      '',
      `📦  **File Size**     ${formatBytes(audioBuffer.length)}`,
      `⚡  **API Response**  ${formatMs(serverMs)}`,
      `🎬  **Video**         ${mp4Url}`,
    ].join('\n');

    const resultPayload = {
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment: [
        {
          name: safeFilename(displayLabel),
          stream: audioBuffer,
        },
      ],
    };

    if (loadingId) {
      try {
        await chat.editMessage({ ...resultPayload, message_id_to_edit: loadingId });
      } catch {
        await dismissLoading();
        await chat.replyMessage(resultPayload);
      }
    } else {
      await chat.replyMessage(resultPayload);
    }
  } catch (err) {
    const error = err as { message?: string };

    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message: [
        `❌  **Could not retrieve audio for** \`${displayLabel}\``,
        `\`${error.message ?? 'An unexpected error occurred.'}\``,
      ].join('\n'),
    };

    if (loadingId) {
      await chat.editMessage({ ...errPayload, message_id_to_edit: loadingId }).catch(async () => {
        await dismissLoading();
        await chat.replyMessage(errPayload);
      });
    } else {
      await chat.replyMessage(errPayload);
    }
  }
};