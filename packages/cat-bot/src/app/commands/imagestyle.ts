/**
 * Image Style Transform — multi-command family (single file)
 *
 * A shared codebase-driven command family: every entry sends the user's
 * photo (attached or replied-to) to a "faaa" style-transform endpoint and
 * returns the rendered result as an image attachment.
 *
 * This file intentionally mirrors the original config-table pattern (one
 * `run()` implementation + a data-only `STYLE_CONFIGS` table + a generated
 * `commands` export) rather than one file per style — the loader
 * (`engine/app.ts` loadCommands) natively supports a file exporting
 * `commands: Array<{ meta, onCommand }>` and registers each entry exactly
 * like a standalone command module.
 *
 * Flow (per command):
 *   User: /toanime [attach or reply to a photo]
 *   Bot:  [style-transformed image]
 *
 * Note: the original "tobugil" / "deepnude" / "removeclothes" variant from
 * the legacy config table is intentionally NOT ported — a tool that strips
 * clothing from an arbitrary uploaded photo is a non-consensual intimate
 * imagery generator and is never implemented here, regardless of framing.
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

// ── Outbound request headers ─────────────────────────────────────────────────
//
// Several free third-party API providers (including the "faaa" host used
// here) apply basic bot-protection and reject requests that don't look like
// they came from a browser — returning 403 even though the exact same URL
// loads fine when opened directly. A standard desktop User-Agent/Accept pair
// is enough to pass that check.
const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'image/*,*/*;q=0.8',
};

/** Best-effort decode of a non-2xx response body for diagnostics (many of these
 *  free API providers return a JSON/plain-text reason even on 403/500). */
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

/**
 * Downloads the rendered image ourselves (rather than handing a bare URL to
 * attachment_url) so a non-2xx response is caught and reported here with a
 * clear, per-command message instead of surfacing as an opaque download
 * failure deeper in the platform wrapper.
 */
async function fetchStyledImage(
  requestUrl: string,
  sourceImageUrl: string,
  label: string,
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
      `[imagestyle] ${label} failed (status ${response.status}): ${reason} | request=${requestUrl} | source=${sourceImageUrl}`,
    );
    throw new Error(`${label} API responded with status ${response.status}: ${reason}`);
  }

  const buffer = Buffer.from(response.data);
  if (!buffer.length) throw new Error(`${label} API returned an empty image`);

  return buffer;
}

// ── Config table ──────────────────────────────────────────────────────────────

interface StyleConfig {
  name: string;
  aliases: string[];
  path: string;
  label: string;
  description: string;
}

const STYLE_CONFIGS: StyleConfig[] = [
  {
    name: 'toanime',
    aliases: ['animekan'],
    path: '/faa/toanime',
    label: 'Anime Style',
    description: 'Transform a photo into anime-style artwork.',
  },
  {
    name: 'tochibi',
    aliases: ['chibikan'],
    path: '/faa/tochibi',
    label: 'Chibi Style',
    description: 'Turn a photo into a cute chibi-style illustration.',
  },
  {
    name: 'tofigure',
    aliases: ['figurekan'],
    path: '/faa/tofigura',
    label: 'Figure Style',
    description: 'Turn a photo into a collectible figure-style render.',
  },
  {
    name: 'toghibli',
    aliases: ['ghiblikan'],
    path: '/faa/toghibli',
    label: 'Ghibli Style',
    description: 'Restyle a photo in a Studio Ghibli-inspired art style.',
  },
  {
    name: 'tohijab',
    aliases: ['hijabkan'],
    path: '/faa/tohijab',
    label: 'Hijab Style',
    description: 'Apply a hijab styling effect to a photo.',
  },
  {
    name: 'tohitam',
    aliases: ['hitamkan'],
    path: '/faa/tohitam',
    label: 'Black & White Style',
    description: 'Convert a photo into a black-and-white style render.',
  },
  {
    name: 'tolego',
    aliases: ['legokan'],
    path: '/faa/tolego',
    label: 'LEGO Style',
    description: 'Turn a photo into a LEGO-figure style render.',
  },
  {
    name: 'tomaid',
    aliases: ['maidkan'],
    path: '/faa/tomaid',
    label: 'Maid Style',
    description: 'Restyle a photo with a maid-outfit theme.',
  },
  {
    name: 'tomirrorselfie',
    aliases: ['mirrorselfiekan'],
    path: '/faa/tomirror',
    label: 'Mirror Selfie Style',
    description: 'Turn a photo into a mirror-selfie style shot.',
  },
  {
    name: 'toroblox',
    aliases: ['robloxkan'],
    path: '/faa/toroblox',
    label: 'Roblox Style',
    description: 'Turn a photo into a Roblox-avatar style render.',
  },
  {
    name: 'tostreetwear',
    aliases: ['streetwearkan'],
    path: '/faa/tostreetwear',
    label: 'Streetwear Style',
    description: 'Restyle a photo with a streetwear fashion theme.',
  },
  {
    name: 'tounderground',
    aliases: ['undergroundkan'],
    path: '/faa/tounderground',
    label: 'Underground Style',
    description: 'Restyle a photo with an underground/urban aesthetic.',
  },
  {
    name: 'tovintage',
    aliases: ['vintagekan'],
    path: '/faa/tovintage',
    label: 'Vintage Style',
    description: 'Restyle a photo with a vintage, retro film look.',
  },
];

// ── Shared handler ────────────────────────────────────────────────────────────

async function runStyleTransform(
  ctx: AppCtx,
  config: StyleConfig,
): Promise<void> {
  const { chat } = ctx;
  const imageUrl = resolveImageUrl(ctx);

  if (!imageUrl) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: NO_IMAGE_MESSAGE,
    });
    return;
  }

  try {
    const requestUrl = createUrl('faaa', config.path, { url: imageUrl });
    const image = await fetchStyledImage(requestUrl, imageUrl, config.label);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **${config.label}**`,
      attachment: [{ name: `${config.name}.png`, stream: image }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to generate the image: \`${message}\``,
    });
  }
}

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = STYLE_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases,
    version: '1.0.0',
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: config.description,
    category: 'AI Disc',
    usage: ['(send a photo, or reply to one)'],
    cooldown: 8,
    hasPrefix: true,
  },
  onCommand: async (ctx: AppCtx) => runStyleTransform(ctx, config),
}));
