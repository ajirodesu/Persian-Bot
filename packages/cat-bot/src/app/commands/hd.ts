/**
 * /hd — AI Image Upscaler / Enhancer
 *
 * Converts the WhatsApp "hd" command: takes an image (attached with the
 * command, or via reply), sends it to the Alwayscodex "ai-enhance" HD
 * endpoint, and returns the enhanced image as an attachment.
 *
 * The original WhatsApp flow uploaded the media to get a public URL before
 * calling the endpoint. Cat-Bot's unified attachment layer already exposes a
 * public `url` for Discord/Telegram attachments, so we pass that straight to
 * the API — same convention as the image commands in popcat-media.ts. The
 * enhanced response is downloaded and validated locally (rather than handed to
 * the client as a bare URL) so non-2xx errors surface with a clear message.
 *
 * Flow:
 *   User: /hd (with a photo, or replying to one)
 *   Bot:  [enhanced image]
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

// ── Attachment resolution (same convention as popcat-media.ts) ──────────────

/** Minimal shape read off a unified attachment entry. */
interface RawAttachment {
  type?: string;
  url?: string | null;
  filename?: string | null;
  name?: string | null;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp)(?:\?.*)?$/i;

/** True when a raw attachment looks like a static/animated image. */
function isImageAttachment(att: RawAttachment): boolean {
  const type = (att.type ?? '').toLowerCase();
  if (
    type === AttachmentType.PHOTO ||
    type === AttachmentType.ANIMATED_IMAGE ||
    type === 'gif'
  ) {
    return true;
  }
  const probe = att.filename ?? att.name ?? att.url ?? '';
  return IMAGE_EXT_RE.test(probe);
}

/**
 * Resolves an image URL from the triggering message first, then falls back to
 * the replied-to message.
 */
async function resolveImageUrl(ctx: AppCtx): Promise<string | null> {
  const event = ctx.event;

  const direct = (event['attachments'] as RawAttachment[] | undefined) ?? [];
  const fromDirect = direct.find((a) => a?.url && isImageAttachment(a));
  if (fromDirect?.url) return fromDirect.url;

  const reply = event['messageReply'] as
    | Record<string, unknown>
    | null
    | undefined;
  const replyAttachments =
    (reply?.['attachments'] as RawAttachment[] | undefined) ?? [];
  const fromReply = replyAttachments.find((a) => a?.url && isImageAttachment(a));
  if (fromReply?.url) return fromReply.url;

  return null;
}

const NO_IMAGE_MESSAGE =
  '📎 **Missing image.** Send a photo with this command, or reply to one, to continue.';

// ── Outbound request headers ─────────────────────────────────────────────────
//
// A standard desktop User-Agent/Accept pair avoids basic bot-protection
// rejections some free API providers apply to headerless requests.
const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'image/*,*/*;q=0.8',
};

/** Best-effort decode of a non-2xx response body for diagnostics. */
function describeErrorBody(data: ArrayBuffer): string {
  try {
    const text = Buffer.from(data).toString('utf8').trim().slice(0, 300);
    if (!text) return '(empty body)';
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const reason = parsed['message'] ?? parsed['error'] ?? parsed['msg'];
      if (typeof reason === 'string') return reason;
    } catch {
      // not JSON — fall through to raw text
    }
    return text;
  } catch {
    return '(unreadable body)';
  }
}

/** Picks a sensible file extension from the response Content-Type header. */
function extFromContentType(contentType: unknown): string {
  const type = String(contentType ?? '').toLowerCase();
  if (type.includes('gif')) return 'gif';
  if (type.includes('webp')) return 'webp';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  return 'png';
}

/**
 * Downloads the enhanced image ourselves (rather than handing a bare URL to
 * attachment_url) so a non-2xx response is caught and reported clearly.
 */
async function fetchEnhancedImage(requestUrl: string): Promise<{ buffer: Buffer; ext: string }> {
  const response = await axios.get<ArrayBuffer>(requestUrl, {
    responseType: 'arraybuffer',
    timeout: 60_000,
    headers: REQUEST_HEADERS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    const reason = describeErrorBody(response.data);
    logger.warn(`[hd] enhance failed (status ${response.status}): ${reason} | request=${requestUrl}`);
    throw new Error(`HD API responded with status ${response.status}: ${reason}`);
  }

  const buffer = Buffer.from(response.data);
  if (!buffer.length) throw new Error('HD API returned an empty image');

  return { buffer, ext: extFromContentType(response.headers['content-type']) };
}

// ── Config ───────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'hd',
  aliases: ['enhance', 'imagehd', 'upscale'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Enhance and upscale an image using AI.',
  category: 'image',
  usage: '<image>',
  cooldown: 6,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram, Platforms.Fluxer],
};

// ── Command Handler ──────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat } = ctx;

  const imageUrl = await resolveImageUrl(ctx);
  if (!imageUrl) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: NO_IMAGE_MESSAGE,
    });
    return;
  }

  try {
    const requestUrl = createUrl('alwayscodex', '/api/imagehd/ai-enhance', {
      url: imageUrl,
    });
    const { buffer, ext } = await fetchEnhancedImage(requestUrl);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '✨ **Enhanced HD image**',
      attachment: [{ name: `hd.${ext}`, stream: buffer }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to enhance the image: \`${message}\``,
    });
  }
};