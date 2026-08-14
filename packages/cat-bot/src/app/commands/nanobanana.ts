/**
 * /nanobanana — Nano Banana Image-to-Image (Premium)
 *
 * Ports `commands/ai/nanobanana.js`. Transforms an attached image using Google's
 * Nano Banana model via the `faaa` provider. Requires an image (sent with the
 * command or replied to) plus a text prompt, and Premium access.
 *
 * Flow:
 *   User: /nanobanana make it evangelion art style  (with/replying-to a photo)
 *   Bot:  [transformed image + prompt caption]
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { AttachmentType } from '@/engine/adapters/models/enums/index.js';

// ── Image attachment resolution (same convention as hd.ts / popcat-media.ts) ──

interface RawAttachment {
  type?: string;
  url?: string | null;
  filename?: string | null;
  name?: string | null;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp)(?:\?.*)?$/i;

function isImageAttachment(att: RawAttachment): boolean {
  const type = (att.type ?? '').toLowerCase();
  if (
    type === AttachmentType.PHOTO ||
    type === AttachmentType.ANIMATED_IMAGE ||
    type === 'gif'
  ) {
    return true;
  }
  return IMAGE_EXT_RE.test(att.filename ?? att.name ?? att.url ?? '');
}

async function resolveImageUrl(ctx: AppCtx): Promise<string | null> {
  const event = ctx.event;
  const direct = (event['attachments'] as RawAttachment[] | undefined) ?? [];
  const fromDirect = direct.find((a) => a?.url && isImageAttachment(a));
  if (fromDirect?.url) return fromDirect.url;

  const reply = event['messageReply'] as
    | Record<string, unknown>
    | null
    | undefined;
  const replyAtts = (reply?.['attachments'] as RawAttachment[] | undefined) ?? [];
  const fromReply = replyAtts.find((a) => a?.url && isImageAttachment(a));
  if (fromReply?.url) return fromReply.url;

  return null;
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'nanobanana',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.PREMIUM,
  author: 'AjiroDesu',
  description:
    'Transform an attached image using Google Nano Banana AI (image-to-image).',
  category: 'AI Image',
  usage: '<prompt> (with/replying to a photo)',
  cooldown: 10,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { usage } = ctx;

  const prompt = ctx.args.join(' ').trim();
  if (!prompt) {
    await usage();
    return;
  }

  const imageUrl = await resolveImageUrl(ctx);
  if (!imageUrl) {
    await ctx.chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '📎 **Missing image.** Send a photo with this command, or reply to one, to continue.',
    });
    return;
  }

  try {
    const url = createUrl('faaa', '/faa/nano-banana', {
      url: imageUrl,
      prompt,
    });

    await ctx.chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **Prompt:** ${prompt}`,
      attachment_url: [{ name: 'nanobanana.png', url }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await ctx.chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to transform the image: \`${error.message ?? 'Unknown error'}\``,
    });
  }
};