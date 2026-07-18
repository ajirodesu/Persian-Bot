/**
 * youtube.ts — YouTube Audio/Video Downloader (multi-command family, config-driven)
 *
 * Cat-Bot port + merge of two previously-standalone legacy modules
 * (youtubeaudio.ts, youtubevideo.ts). Same architecture as popcat-media.ts /
 * popcat-text.ts / animal-photos.ts: one YT_CONFIGS table declares each
 * command's shape (API provider, response parsing, available flags), and one
 * shared runYtCommand() dispatches on that config. Adding a future YouTube
 * endpoint (e.g. thumbnail) means appending one config object — no new
 * onCommand function required.
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand }>` and registers each entry
 * exactly like a standalone command module — this is that shape.
 *
 * ── Commands ──────────────────────────────────────────────────────────────
 *   /youtubeaudio <url> [-d]              — MP3 audio (aliases: yta, ytaudio, ytmp3)
 *   /youtubevideo <url> [-d] [-r <res>]   — MP4 video  (aliases: ytmp4, ytv, ytvideo)
 *
 * Both accept the link either as an argument or extracted from a quoted
 * reply, mirroring the original `flag.input || extractUrlFromText(quoted)`
 * fallback. All user-facing text has been translated to English — the
 * original captions were in Indonesian ("Kirim sebagai dokumen", etc.).
 *
 * ── Flags ─────────────────────────────────────────────────────────────────
 *   -d              Send with a source-URL caption (both commands)
 *   -r <resolution> Video quality — youtubevideo only (default: 360)
 *
 * Flag parsing accepts both space-separated (`-r 720`) and equals-sign
 * (`-r=720`) forms, and strips them fully from the URL text either way —
 * same guarantee already applied to playv2's -i/-s flags.
 *
 * ── "Document" mode (-d) ─────────────────────────────────────────────────
 * The original platform distinguished an inline audio/video player from a
 * generic downloadable "document" attachment. Cat-Bot's unified send layer
 * has no such distinction — every reply is just a named `attachment_url`
 * entry, and each platform renders it inline or not based on its own
 * extension/MIME handling. `-d` is preserved as a caption toggle instead:
 * off, youtubeaudio sends bare audio with no caption (matching the
 * original's silent inline-player reply) while youtubevideo still shows the
 * source-URL caption either way (matching the original, which captioned its
 * non-document video reply too). `-d` just adds the caption for audio.
 *
 * ── API providers (apis.lib.ts) ──────────────────────────────────────────
 *   youtubeaudio: delirius     /download/ytmp3            → data.download
 *   youtubevideo: alwayscodex  /api/downloader/youtube2    → result.downloadUrl
 *
 * Note: the original modules gated each command behind `permissions: { coin: 10 }`.
 * That balance requirement has been intentionally dropped, matching the same
 * decision already made for `download` and `playv2` — both commands here are
 * free to use.
 *
 * Author: AjiroDesu
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { withLoadingMedia } from '@/engine/utils/media-loading.util.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// ── URL resolution (arg or quoted reply) ────────────────────────────────────────

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

/** Scans free-form text for the first http(s) URL token. */
function extractUrlFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  return URL_TOKEN_RE.exec(text)?.[0] ?? null;
}

// ── Flag parsing (-d boolean, -r <resolution> value) ────────────────────────────
//
// Accepts both "-r 720" and "-r=720" forms. Only exact "-d"/"-r" tokens are
// treated as flags, so their syntax never leaks into the resolved URL text.

interface ParsedYtFlags {
  url: string;
  document: boolean;
  resolution: string;
}

function parseYtFlags(args: string[], hasResolutionFlag: boolean): ParsedYtFlags {
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

// ── Config table ──────────────────────────────────────────────────────────────

interface FetchedMedia {
  title: string;
  downloadUrl: string;
}

interface YtDownloadConfig {
  name: string;
  aliases: string[];
  label: string;
  description: string;
  fileExtension: 'mp3' | 'mp4';
  hasResolutionFlag: boolean;
  /** Whether the non-document (bare) reply still shows the source-URL caption. */
  captionOnStream: boolean;
  exampleSuffix: string;
  flagLines: string[];
  fetchMedia: (url: string, resolution: string) => Promise<FetchedMedia>;
}

const YT_CONFIGS: YtDownloadConfig[] = [
  {
    name: 'youtubeaudio',
    aliases: ['yta', 'ytaudio', 'ytmp3'],
    label: 'YouTube Audio',
    description: 'Downloads a YouTube video as MP3 audio.',
    fileExtension: 'mp3',
    hasResolutionFlag: false,
    captionOnStream: false,
    exampleSuffix: '-d',
    flagLines: ['`-d` — Send with a source-URL caption'],
    fetchMedia: async (url): Promise<FetchedMedia> => {
      const apiUrl = createUrl('delirius', '/download/ytmp3', { url });
      const res = await axios.get(apiUrl, { timeout: 30_000 });
      const data = res.data?.data as { title?: string; download?: string } | undefined;
      if (!data?.download) {
        throw new Error('No downloadable audio was returned for this YouTube link.');
      }
      return { title: data.title ?? 'audio', downloadUrl: data.download };
    },
  },
  {
    name: 'youtubevideo',
    aliases: ['ytmp4', 'ytv', 'ytvideo'],
    label: 'YouTube Video',
    description: 'Downloads a YouTube video as MP4.',
    fileExtension: 'mp4',
    hasResolutionFlag: true,
    captionOnStream: true,
    exampleSuffix: '-d -r 720',
    flagLines: [
      '`-d` — Send with a source-URL caption',
      '`-r <number>` — Video resolution (available: 144, 240, 360, 480, 720, 1080, 1440, 2160 | default: 360)',
    ],
    fetchMedia: async (url, resolution): Promise<FetchedMedia> => {
      // Whitelist copied verbatim from the original module. Note '144' and
      // '240' are advertised in the flag help text above (matching the
      // original's own help text) but were never actually accepted here —
      // that mismatch existed in the source module and is preserved as-is
      // rather than silently "fixed" during conversion.
      const VALID_RESOLUTIONS = ['360', '480', '720', '1080', '1440', '2160'];
      const quality = VALID_RESOLUTIONS.includes(resolution) ? `${resolution}p` : '720p';

      const apiUrl = createUrl('alwayscodex', '/api/downloader/youtube2', { url, quality });
      const res = await axios.get(apiUrl, { timeout: 60_000 });
      const result = res.data?.result as { title?: string; downloadUrl?: string } | undefined;
      if (!result?.downloadUrl) {
        throw new Error('No downloadable video was returned for this YouTube link.');
      }
      return { title: result.title ?? 'video', downloadUrl: result.downloadUrl };
    },
  },
];

// ── Instructions shown when no link is supplied ─────────────────────────────────

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

// ── Shared handler ────────────────────────────────────────────────────────────

async function runYtCommand(ctx: AppCtx, config: YtDownloadConfig): Promise<void> {
  const { chat, args, event, prefix } = ctx;
  const parsed = parseYtFlags(args, config.hasResolutionFlag);

  let url = parsed.url ? normalizeCandidate(parsed.url) : '';

  if (!url) {
    const messageReply = event['messageReply'] as Record<string, unknown> | undefined;
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
      message: '❌ That doesn\'t look like a valid URL.',
    });
    return;
  }

  const loading = await withLoadingMedia(ctx, `⏳ **Fetching ${config.label}...**`);

  try {
    const media = await config.fetchMedia(url, parsed.resolution);
    const fileName = `${media.title}.${config.fileExtension}`;
    const showCaption = parsed.document || config.captionOnStream;

    await loading.finish({
      style: MessageStyle.MARKDOWN,
      message: showCaption ? `❖ **URL**: ${url}` : '',
      attachment_url: [{ name: fileName, url: media.downloadUrl }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[${config.name}] failed: ${message}`);
    await loading.fail(`⚠️ Failed to download: \`${message}\``);
  }
}

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = YT_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases,
    version: '1.0.0',
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: config.description,
    category: 'Downloader',
    guide: [
      `<url> — ${config.description}`,
      ...config.flagLines.map((line) => `<url> ${line}`),
    ],
    cooldown: 10,
    hasPrefix: true,
    platform: [Platforms.Discord, Platforms.Telegram],
    options: [
      {
        type: OptionType.string,
        name: 'url',
        description: `YouTube link${config.hasResolutionFlag ? ', plus optional -d and -r <resolution> flags' : ', plus optional -d flag'}`,
        required: true,
      },
    ],
  },
  onCommand: async (ctx: AppCtx) => runYtCommand(ctx, config),
}));