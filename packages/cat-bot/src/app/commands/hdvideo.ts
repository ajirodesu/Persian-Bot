/**
 * /hdvideo — AI Video Upscaler / Enhancer
 *
 * Converts the WhatsApp "hdvideo" command: takes a video (attached with the
 * command, or via reply), sends it to Nexray's "hdvideo" HD endpoint, and
 * returns the enhanced video as an attachment.
 *
 * The WhatsApp flow uploaded the media to get a public URL before calling the
 * endpoint. Cat-Bot's unified attachment layer already exposes a public `url`
 * for Discord/Telegram videos, so we pass that straight to the API. Nexray
 * returns JSON with an `result` field holding the direct HD video URL.
 *
 * The final HD video is downloaded to a Buffer ourselves (not handed to the
 * client as a bare URL) — the same reliability measure as download.ts, since
 * several Nexray-backed video CDNs reject or mis-serve the remote-fetch
 * clients (Telegram's sendVideo fetcher, Discord's attachment proxy) and
 * surface "failed to get HTTP URL content" errors.
 *
 * Flow:
 *   User: /hdvideo (with a video, or replying to one)
 *   Bot:  [enhanced video]
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { AttachmentType } from '@/engine/adapters/models/enums/index.js';

// ── Attachment resolution (same convention as download.ts / hd.ts) ───────────

/** Minimal shape read off a unified attachment entry. */
interface RawAttachment {
  type?: string;
  url?: string | null;
  filename?: string | null;
  name?: string | null;
}

const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv|avi|m4v|flv|ogv)(?:\?.*)?$/i;

/** True when a raw attachment looks like a video file. */
function isVideoAttachment(att: RawAttachment): boolean {
  const type = (att.type ?? '').toLowerCase();
  if (type === AttachmentType.VIDEO) return true;
  const probe = att.filename ?? att.name ?? att.url ?? '';
  return VIDEO_EXT_RE.test(probe);
}

/**
 * Resolves a video URL from the triggering message first, then falls back to
 * the replied-to message.
 */
async function resolveVideoUrl(ctx: AppCtx): Promise<string | null> {
  const event = ctx.event;

  const direct = (event['attachments'] as RawAttachment[] | undefined) ?? [];
  const fromDirect = direct.find((a) => a?.url && isVideoAttachment(a));
  if (fromDirect?.url) return fromDirect.url;

  const reply = event['messageReply'] as
    | Record<string, unknown>
    | null
    | undefined;
  const replyAttachments =
    (reply?.['attachments'] as RawAttachment[] | undefined) ?? [];
  const fromReply = replyAttachments.find((a) => a?.url && isVideoAttachment(a));
  if (fromReply?.url) return fromReply.url;

  return null;
}

const NO_VIDEO_MESSAGE =
  '🎬 **Missing video.** Send a video with this command, or reply to one, to continue.';

// ── Nexray request headers (same as download.ts) ─────────────────────────────
const NEXRAY_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

const HDVIDEO_API_TIMEOUT_MS = 20_000;

/** Generous timeout for downloading the enhanced video binary (files can be large). */
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** Hard cap on a single downloaded file — protects memory/bandwidth against runaway responses. */
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

interface HdVideoResponse {
  status?: boolean;
  message?: string;
  error?: string;
  result?: string;
}

/** Calls the Nexray HD-video endpoint and returns the enhanced video URL (`result`). */
async function fetchEnhancedVideoUrl(sourceUrl: string): Promise<string> {
  const apiUrl = createUrl('nexray', '/tools/v1/hdvideo', { url: sourceUrl });
  const response = await axios.get<HdVideoResponse>(apiUrl, {
    timeout: HDVIDEO_API_TIMEOUT_MS,
    headers: NEXRAY_HEADERS,
    validateStatus: (status) => status >= 200 && status < 500,
  });

  if (response.status >= 400) {
    throw new Error(`Nexray API returned HTTP ${response.status}`);
  }

  const body = response.data ?? {};
  if (body.status === false) {
    throw new Error(
      body.message || body.error || 'The API could not process this video.',
    );
  }

  const result = body.result;
  if (!result) throw new Error('The API did not return an enhanced video URL.');

  return result;
}

/**
 * Downloads the enhanced video bytes into a Buffer so we forward it as a real
 * attachment instead of a remote URL (avoids CDN remote-fetch failures).
 */
async function downloadVideo(url: string): Promise<Buffer | null> {
  try {
    const res = await axios.get<ArrayBuffer>(url, {
      timeout: DOWNLOAD_TIMEOUT_MS,
      headers: NEXRAY_HEADERS,
      responseType: 'arraybuffer',
      maxContentLength: MAX_DOWNLOAD_BYTES,
      maxBodyLength: MAX_DOWNLOAD_BYTES,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    const buffer = Buffer.from(res.data);
    if (buffer.length === 0) throw new Error('Downloaded video is empty.');
    return buffer;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[hdvideo] failed to fetch enhanced video binary: ${message}`);
    return null;
  }
}

// ── Config ───────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'hdvideo',
  aliases: ['hdvid'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Enhance and upscale a video using AI.',
  category: 'image',
  usage: '<video>',
  cooldown: 10,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram],
};

// ── Command Handler ──────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat } = ctx;

  const videoUrl = await resolveVideoUrl(ctx);
  if (!videoUrl) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: NO_VIDEO_MESSAGE,
    });
    return;
  }

  try {
    const enhancedUrl = await fetchEnhancedVideoUrl(videoUrl);

    const buffer = await downloadVideo(enhancedUrl);
    if (!buffer) {
      throw new Error('The enhanced video could not be downloaded — the source may be unavailable.');
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '✨ **Enhanced HD video**',
      attachment: [{ name: 'hdvideo.mp4', stream: buffer }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to enhance the video: \`${message}\``,
    });
  }
};