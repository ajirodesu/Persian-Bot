/**
 * AI Image Editor — multi-command family (single file)
 *
 * A shared codebase-driven command family: every entry sends the user's
 * photo (attached or replied-to) plus a text prompt to an AI image-editing
 * endpoint and returns the edited result as an image attachment.
 *
 * Two provider shapes are supported, mirroring the legacy config table:
 *   - 'direct' — the built URL itself serves the image; it is passed
 *                straight through as attachment_url with no HTTP call made
 *                here (the platform wrapper downloads it before sending).
 *   - 'axios'  — the built URL returns JSON; the result image URL is read
 *                out of a dotted `resultPath` (e.g. "data.image").
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand }>` and registers each entry
 * exactly like a standalone command module.
 *
 * Flow (per command):
 *   User: /editimage make it evangelion art style [attach or reply to a photo]
 *   Bot:  [edited image + prompt caption]
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { AttachmentType } from '@/engine/adapters/models/enums/index.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// ── Shared attachment resolution ─────────────────────────────────────────────

/** Minimal shape read off a unified attachment entry (see attachment.prototypes.ts). */
interface RawAttachment {
  type?: string;
  url?: string | null;
  filename?: string | null;
  name?: string | null;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp)(?:\?.*)?$/i;

/**
 * True when a raw attachment looks like a static/animated image.
 * Telegram tags images as 'photo' (and gifs as 'gif'); Discord tags every
 * attachment as generic 'file', so filename/url extension is the fallback.
 */
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
 * Resolves an image URL from the triggering message first, falling back to
 * the replied-to message — mirrors the legacy checkMedia → checkQuotedMedia
 * fallback order.
 */
function resolveImageUrl(ctx: AppCtx): string | null {
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
  return fromReply?.url ?? null;
}

const NO_IMAGE_MESSAGE =
  '📎 **Missing image.** Send a photo with this command, or reply to one, to continue.';
const GENERIC_ERROR =
  '⚠️ **Service temporarily unavailable.** Please try again in a moment.';

// ── Outbound request headers ─────────────────────────────────────────────────
//
// Several free third-party API providers apply basic bot-protection and
// reject requests that don't look like they came from a browser — returning
// 403 even though the exact same URL loads fine when opened directly. A
// standard desktop User-Agent/Accept pair is enough to pass that check.
const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json,image/*,*/*;q=0.8',
};

/** Best-effort decode of a non-2xx response body for diagnostics (many of these
 *  free API providers return a JSON/plain-text reason even on 403/500). */
function describeErrorBody(data: ArrayBuffer | unknown): string {
  try {
    const text =
      data instanceof ArrayBuffer
        ? Buffer.from(data).toString('utf8').trim().slice(0, 300)
        : typeof data === 'string'
          ? data.trim().slice(0, 300)
          : JSON.stringify(data).slice(0, 300);
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

/**
 * Downloads the final rendered image ourselves (rather than handing a bare
 * URL to attachment_url) so a non-2xx response is caught and reported here
 * with a clear, per-command message instead of surfacing as an opaque
 * download failure deeper in the platform wrapper.
 */
async function fetchEditedImage(
  requestUrl: string,
  sourceImageUrl: string,
  name: string,
): Promise<Buffer> {
  const response = await axios.get<ArrayBuffer>(requestUrl, {
    responseType: 'arraybuffer',
    timeout: 30_000,
    headers: REQUEST_HEADERS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    const reason = describeErrorBody(response.data);
    logger.warn(
      `[editimage] ${name} failed (status ${response.status}): ${reason} | request=${requestUrl} | source=${sourceImageUrl}`,
    );
    throw new Error(`${name} API responded with status ${response.status}: ${reason}`);
  }

  const buffer = Buffer.from(response.data);
  if (!buffer.length) throw new Error(`${name} API returned an empty image`);

  return buffer;
}

/** Reads a dotted path (e.g. "data.image") out of an unknown JSON value. */
function getPath(obj: unknown, dottedPath: string): string | null {
  const value = dottedPath.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);

  return typeof value === 'string' ? value : null;
}

// ── Config table ──────────────────────────────────────────────────────────────

interface EditConfigDirect {
  name: string;
  aliases: string[];
  kind: 'direct';
  base: string;
  path: string;
  urlParam?: string;
  apiKeyParam?: string;
  description: string;
}

interface EditConfigAxios {
  name: string;
  aliases: string[];
  kind: 'axios';
  base: string;
  path: string;
  urlParam?: string;
  resultPath: string;
  description: string;
}

type EditConfig = EditConfigDirect | EditConfigAxios;

const EDIT_CONFIGS: EditConfig[] = [
  {
    name: 'editimage',
    aliases: ['editimg'],
    kind: 'direct',
    base: 'faaa',
    path: '/faa/editfoto',
    description: 'Edit a photo with AI based on a text prompt.',
  },
  {
    name: 'editimage2',
    aliases: ['editimg2'],
    kind: 'direct',
    base: 'faaa',
    path: '/faa/nano-banana',
    description: 'Edit a photo with AI (Nano Banana engine) based on a text prompt.',
  },
  {
    name: 'editimage3',
    aliases: ['editimg3'],
    kind: 'axios',
    base: 'lexcode',
    path: '/api/ai/nano-banana',
    urlParam: 'url',
    resultPath: 'result.image',
    description: 'Edit a photo with AI (Nano Banana engine) based on a text prompt.',
  },
  {
    name: 'editimage4',
    aliases: ['editimg4'],
    kind: 'axios',
    base: 'lexcode',
    path: '/api/ai/deepai-editor',
    urlParam: 'imgUrl',
    resultPath: 'result.image',
    description: 'Edit a photo with AI (DeepAI editor) based on a text prompt.',
  },
  {
    name: 'editimage5',
    aliases: ['editimg5'],
    kind: 'direct',
    base: 'neosoft',
    path: '/api/ai-image/editimage',
    description: 'Edit a photo with AI based on a text prompt.',
  },
  {
    name: 'editimage6',
    aliases: ['editimg6'],
    kind: 'direct',
    base: 'sanka',
    path: '/ai/editimg',
    apiKeyParam: 'apikey',
    description: 'Edit a photo with AI based on a text prompt.',
  },
  {
    name: 'editimage7',
    aliases: ['editimg7'],
    kind: 'axios',
    base: 'kuroneko',
    path: '/api/tools/nanobanana',
    urlParam: 'media',
    resultPath: 'data.image',
    description: 'Edit a photo with AI (Nano Banana engine) based on a text prompt.',
  },
];

// ── Shared handler ────────────────────────────────────────────────────────────

async function runEditImage(ctx: AppCtx, config: EditConfig): Promise<void> {
  const { chat, args, usage } = ctx;
  const prompt = args.join(' ').trim();

  if (!prompt) {
    await usage();
    return;
  }

  const imageUrl = resolveImageUrl(ctx);
  if (!imageUrl) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: NO_IMAGE_MESSAGE,
    });
    return;
  }

  const urlParam = config.urlParam ?? 'url';

  try {
    let resultUrl: string | null = null;

    if (config.kind === 'direct') {
      resultUrl = createUrl(
        config.base,
        config.path,
        { [urlParam]: imageUrl, prompt },
        config.apiKeyParam,
      );
    } else {
      const requestUrl = createUrl(config.base, config.path, {
        [urlParam]: imageUrl,
        prompt,
      });
      const jsonResponse = await axios.get<unknown>(requestUrl, {
        timeout: 30_000,
        headers: REQUEST_HEADERS,
        validateStatus: () => true,
      });

      if (jsonResponse.status < 200 || jsonResponse.status >= 300) {
        const reason = describeErrorBody(jsonResponse.data);
        logger.warn(
          `[editimage] ${config.name} JSON request failed (status ${jsonResponse.status}): ${reason} | request=${requestUrl} | source=${imageUrl}`,
        );
        throw new Error(
          `${config.name} API responded with status ${jsonResponse.status}: ${reason}`,
        );
      }

      resultUrl = getPath(jsonResponse.data, config.resultPath);
    }

    if (!resultUrl) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: GENERIC_ERROR,
      });
      return;
    }

    const image = await fetchEditedImage(resultUrl, imageUrl, config.name);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🖌️ **Prompt:** ${prompt}`,
      attachment: [{ name: `${config.name}.png`, stream: image }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to edit the image: \`${message}\``,
    });
  }
}

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = EDIT_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases,
    version: '1.0.0',
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: config.description,
    category: 'AI Disc',
    usage: ['<prompt> (send a photo, or reply to one)'],
    cooldown: 10,
    hasPrefix: true,
  },
  onCommand: async (ctx: AppCtx) => runEditImage(ctx, config),
}));
