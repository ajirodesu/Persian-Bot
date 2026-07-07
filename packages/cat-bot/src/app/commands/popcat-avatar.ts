/**
 * Popcat Image Effects — multi-command family (single file)
 *
 * Every entry sends the user's photo (attached or replied-to) to a
 * api.popcat.xyz/v2/<effect> endpoint and returns the rendered result as an
 * image attachment. Every endpoint responds with the raw image bytes
 * directly (no JSON envelope), so the shared handler just downloads and
 * verifies that response before attaching it.
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand }>` and registers each entry
 * exactly like a standalone command module.
 *
 * Flow (per command):
 *   User: /jail [attach or reply to a photo]
 *   Bot:  [effect-rendered image]
 *
 * If no photo was attached or replied to, this now falls back to a profile
 * picture instead of failing outright:
 *   1. an image attached directly to the command message
 *   2. an image in the message being replied to
 *   3. the profile picture of the user being replied to (replying to a
 *      plain-text message and asking for THEIR avatar to be jailed/etc.)
 *   4. the invoking user's own profile picture, as the final fallback
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { AttachmentType } from '@/engine/adapters/models/enums/index.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

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
 * Resolves an image URL to run the effect on, in priority order:
 *   1. an image attached directly to the triggering message
 *   2. an image attached to the message being replied to
 *   3. the profile picture of the user whose message is being replied to
 *      (covers "reply to someone's text and jail their avatar")
 *   4. the invoking user's own profile picture — the guaranteed-to-exist
 *      final fallback, so the command basically never comes up empty
 *
 * Avatar lookups (steps 3-4) only run on platforms whose UnifiedApi actually
 * implements getAvatarUrl() (Discord/Telegram) — on platforms that don't
 * (e.g. Webchat), getAvatarUrl() throws rather than returning null, so those
 * are skipped and the command simply asks for an image instead.
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

  const platform = ctx.native.platform;
  if (platform !== Platforms.Discord && platform !== Platforms.Telegram) {
    // No image was attached/replied, and avatar lookups aren't supported on
    // this platform — nothing left to fall back to.
    return null;
  }

  // Prefer the replied-to user's avatar when replying to a message that
  // carries no image of its own; otherwise fall back to the sender's own
  // avatar (no reply at all, or a reply with neither an image nor a usable
  // sender ID).
  const replySenderID = reply?.['senderID'] as string | undefined;
  const senderID = replySenderID || (event['senderID'] as string | undefined);
  if (!senderID) return null;

  try {
    return await ctx.api.getAvatarUrl(senderID);
  } catch (err) {
    // No avatar available for this user on this platform — no image to use.
    logger.warn('[popcat] Avatar fallback lookup failed', {
      senderID,
      platform,
      error: err,
    });
    return null;
  }
}

const NO_IMAGE_MESSAGE =
  '📎 **Missing image.** Send a photo with this command, reply to one, reply to a user, or make sure your profile has an avatar set.';

// ── Helpers ─────────────────────────────────────────────────────────────────

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
 * Downloads the rendered effect image ourselves (rather than handing a bare
 * URL to attachment_url) so a non-2xx response is caught and reported here
 * with a clear, per-command message.
 */
async function fetchEffectImage(
  requestUrl: string,
  sourceImageUrl: string,
  label: string,
): Promise<{ buffer: Buffer; ext: string }> {
  const response = await axios.get<ArrayBuffer>(requestUrl, {
    responseType: 'arraybuffer',
    timeout: 30_000,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    const reason = describeErrorBody(response.data);
    logger.warn(
      `[popcat] ${label} failed (status ${response.status}): ${reason} | request=${requestUrl} | source=${sourceImageUrl}`,
    );
    throw new Error(
      `${label} API responded with status ${response.status}: ${reason}`,
    );
  }

  const buffer = Buffer.from(response.data);
  if (!buffer.length) throw new Error(`${label} API returned an empty image`);

  return { buffer, ext: extFromContentType(response.headers['content-type']) };
}

// ── Config table ──────────────────────────────────────────────────────────────

interface EffectConfig {
  name: string;
  path: string;
  label: string;
  description: string;
}

const EFFECT_CONFIGS: EffectConfig[] = [
  {
    name: 'ad',
    path: '/v2/ad',
    label: 'Ad',
    description: 'Turn a photo into a fake advertisement billboard meme.',
  },
  {
    name: 'blur',
    path: '/v2/blur',
    label: 'Blur',
    description: 'Apply a blur effect to a photo.',
  },
  {
    name: 'clown',
    path: '/v2/clown',
    label: 'Clown',
    description: 'Overlay a clown filter on a photo.',
  },
  {
    name: 'communism',
    path: '/v2/communism',
    label: 'Communism',
    description: 'Apply the "communism" meme filter to a photo.',
  },
  {
    name: 'drip',
    path: '/v2/drip',
    label: 'Drip',
    description: 'Overlay a "drip" gold-chain meme filter on a photo.',
  },
  {
    name: 'greyscale',
    path: '/v2/greyscale',
    label: 'Greyscale',
    description: 'Convert a photo to greyscale.',
  },
  {
    name: 'invert',
    path: '/v2/invert',
    label: 'Invert',
    description: 'Invert the colors of a photo.',
  },
  {
    name: 'jail',
    path: '/v2/jail',
    label: 'Jail',
    description: 'Overlay jail bars on a photo.',
  },
  {
    name: 'jokeoverhead',
    path: '/v2/jokeoverhead',
    label: 'Joke Overhead',
    description: 'Overlay the "joke went over their head" meme on a photo.',
  },
  {
    name: 'mnm',
    path: '/v2/mnm',
    label: 'M&M',
    description: 'Overlay the M&M meme filter on a photo.',
  },
  {
    name: 'nokia',
    path: '/v2/nokia',
    label: 'Nokia',
    description: 'Overlay the indestructible Nokia phone meme on a photo.',
  },
  {
    name: 'pet',
    path: '/v2/pet',
    label: 'Pet',
    description: 'Turn a photo into the animated "petpet" meme.',
  },
  {
    name: 'uncover',
    path: '/v2/uncover',
    label: 'Uncover',
    description: 'Apply the "uncover" meme filter to a photo.',
  },
  {
    name: 'wanted',
    path: '/v2/wanted',
    label: 'Wanted',
    description: 'Turn a photo into an old-west "wanted" poster.',
  },
];

// ── Shared handler ────────────────────────────────────────────────────────────

async function runEffect(ctx: AppCtx, config: EffectConfig): Promise<void> {
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
    const requestUrl = createUrl('popcat', config.path, { image: imageUrl });
    const { buffer, ext } = await fetchEffectImage(
      requestUrl,
      imageUrl,
      config.label,
    );

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **${config.label}**`,
      attachment: [{ name: `${config.name}.${ext}`, stream: buffer }],
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

export const commands: CommandEntry[] = EFFECT_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: [],
    version: '1.0.0',
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: config.description,
    category: 'image',
    usage: ['(send a photo, reply to one, reply to a user, or leave blank to use your own avatar)'],
    cooldown: 8,
    hasPrefix: true,
    platform: [Platforms.Discord, Platforms.Telegram],
  },
  onCommand: async (ctx: AppCtx) => runEffect(ctx, config),
}));