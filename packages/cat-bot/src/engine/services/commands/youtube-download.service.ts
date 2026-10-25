/**
 * YouTube Download Service — shared implementation for /youtubeaudio and
 * /youtubevideo.
 *
 * Both commands accept a YouTube URL either as an argument or extracted from a
 * quoted reply, support the `-d` caption flag (and `-r` on video), download the
 * media locally with browser headers, and send it as a real stream attachment.
 * The CDN links returned by the API reject both axios defaults and Telegram's
 * server-side fetcher, so downloading the bytes ourselves is required.
 */

import axios from 'axios';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { isNetworkError, withRetry } from '@/engine/lib/retry.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { createMessageDelivery } from './message-delivery.service.js';

const MEDIA_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: '*/*',
};

const MEDIA_DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

async function downloadMedia(url: string): Promise<Buffer> {
  return withRetry(
    async () => {
      const res = await axios.get<ArrayBuffer>(url, {
        timeout: MEDIA_DOWNLOAD_TIMEOUT_MS,
        headers: MEDIA_HEADERS,
        responseType: 'arraybuffer',
        maxContentLength: MAX_DOWNLOAD_BYTES,
        maxBodyLength: MAX_DOWNLOAD_BYTES,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      const buf = Buffer.from(res.data);
      if (buf.length === 0) throw new Error('Downloaded file is empty.');
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

const URL_TOKEN_RE = /https?:\/\/[^\s<>"'()[\]]+/i;

/** If a bare arg lacks a protocol but still looks like a domain, prefix https:// before testing it. */
function normalizeCandidate(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function extractUrlFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  return URL_TOKEN_RE.exec(text)?.[0] ?? null;
}

interface ParsedYtFlags {
  url: string;
  document: boolean;
  resolution: string;
}

function parseYtFlags(
  args: string[],
  hasResolutionFlag: boolean,
): ParsedYtFlags {
  const rest: string[] = [];
  let document = false;
  let resolution = '360';

  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    const lower = token.toLowerCase();

    if (lower === '-d') {
      document = true;
      continue;
    }

    if (hasResolutionFlag) {
      const eqMatch = /^-r=(.+)$/i.exec(token);
      if (eqMatch) {
        resolution = eqMatch[1]!;
        continue;
      }
      if (lower === '-r' && args[i + 1] !== undefined) {
        resolution = args[i + 1]!;
        i++;
        continue;
      }
    }

    rest.push(token);
  }

  return { url: rest.join(' ').trim(), document, resolution };
}

interface FetchedMedia {
  title: string;
  downloadUrl: string;
}

interface YtDlpResponse {
  title?: string;
  media?: { mp3?: string; mp4?: string };
  error?: string;
}

export interface YtDownloadConfig {
  name: string;
  label: string;
  fileExtension: 'mp3' | 'mp4';
  hasResolutionFlag: boolean;
  /** Whether the non-document (bare) reply still shows the source-URL caption. */
  captionOnStream: boolean;
  exampleSuffix: string;
  flagLines: string[];
  fetchMedia: (url: string, resolution: string) => Promise<FetchedMedia>;
}

function buildInstructions(config: YtDownloadConfig, prefix: string): string {
  return [
    `📎 **Send a YouTube link to download ${config.label}.**`,
    '',
    `» \`${prefix}${config.name} https://www.youtube.com/watch?v=0Uhh62MUEic ${config.exampleSuffix}\``,
    '',
    '**Flags:**',
    ...config.flagLines,
    '',
    `You can also reply to a message containing the link with \`${prefix}${config.name}\`.`,
  ].join('\n');
}

/** Runs the shared YouTube download flow for a family config. */
export async function runYtDownload(
  ctx: AppCtx,
  config: YtDownloadConfig,
): Promise<void> {
  const { chat, args, event, prefix } = ctx;
  const parsed = parseYtFlags(args, config.hasResolutionFlag);

  let url = parsed.url ? normalizeCandidate(parsed.url) : '';

  if (!url) {
    const messageReply = event['messageReply'] as
      Record<string, unknown> | undefined;
    const quotedBody = messageReply?.['message'] as string | undefined;
    url = extractUrlFromText(quotedBody) ?? '';
  }

  if (!url) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: buildInstructions(config, prefix || '/'),
    });
    return;
  }

  if (!isHttpUrl(url)) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: "❌ That doesn't look like a valid URL.",
    });
    return;
  }

  const delivery = createMessageDelivery(ctx, { fallbackOnEditFailure: true });

  try {
    const media = await config.fetchMedia(url, parsed.resolution);
    const fileName = `${media.title}.${config.fileExtension}`;
    const showCaption = parsed.document || config.captionOnStream;

    const buffer = await downloadMedia(media.downloadUrl);

    await delivery.deliver({
      style: MessageStyle.MARKDOWN,
      message: showCaption ? `❖ **URL**: ${url}` : '',
      attachment: [{ name: fileName, stream: buffer }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[${config.name}] failed: ${message}`);
    await delivery.fail(`⚠️ Failed to download: \`${message}\``);
  }
}

export const youtubeAudioConfig: YtDownloadConfig = {
  name: 'youtubeaudio',
  label: 'YouTube Audio',
  fileExtension: 'mp3',
  hasResolutionFlag: false,
  captionOnStream: false,
  exampleSuffix: '-d',
  flagLines: ['`-d` — Send with a source-URL caption'],
  fetchMedia: async (url): Promise<FetchedMedia> => {
    const apiUrl = createUrl('ytdlp', '/api/v2/server=1/q', { '': url });
    const res = await axios.get(apiUrl, { timeout: 90_000 });
    const data = res.data as YtDlpResponse | undefined;
    const download = data?.media?.mp3;
    if (!download) {
      throw new Error(
        data?.error ??
          'No downloadable audio was returned for this YouTube link.',
      );
    }
    return { title: data.title ?? 'audio', downloadUrl: download };
  },
};

export const youtubeVideoConfig: YtDownloadConfig = {
  name: 'youtubevideo',
  label: 'YouTube Video',
  fileExtension: 'mp4',
  hasResolutionFlag: true,
  captionOnStream: true,
  exampleSuffix: '-d',
  flagLines: ['`-d` — Send with a source-URL caption'],
  fetchMedia: async (url): Promise<FetchedMedia> => {
    const apiUrl = createUrl('ytdlp', '/api/v2/server=1/q', { '': url });
    const res = await axios.get(apiUrl, { timeout: 90_000 });
    const data = res.data as YtDlpResponse | undefined;
    const download = data?.media?.mp4;
    if (!download) {
      throw new Error(
        data?.error ??
          'No downloadable video was returned for this YouTube link.',
      );
    }
    return { title: data.title ?? 'video', downloadUrl: download };
  },
};
