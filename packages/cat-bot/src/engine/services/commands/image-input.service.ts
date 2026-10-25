/**
 * Image Input Resolution — shared photo/avatar discovery for image commands.
 *
 * Popcat's image effects accept a photo in one of four places. The resolution
 * order is stable across every command that uses it:
 *
 *   1. an image attached to the invoking message
 *   2. an image attached to the replied-to message
 *   3. the replied-to user's avatar (reply to a plain-text message)
 *   4. the invoking user's own avatar (final fallback)
 *
 * Avatar lookups only run on platforms whose UnifiedApi implements
 * getAvatarUrl() (Discord/Telegram). Other platforms return null instead of
 * throwing, so callers can show their "missing image" guidance.
 */

import { AttachmentType } from '@/engine/adapters/models/enums/index.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

/** Minimal shape read off a unified attachment entry (see attachment.prototypes.ts). */
export interface RawAttachment {
  type?: string;
  url?: string | null;
  filename?: string | null;
  name?: string | null;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp)(?:\?.*)?$/i;

/** True when a raw attachment looks like a static or animated image. */
export function isImageAttachment(att: RawAttachment): boolean {
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

export interface ImageResolutionOptions {
  /** Log avatar lookup failures (used by the avatar-based effects family). */
  logAvatarFailure?: boolean;
  /** Prefix used for diagnostic logs, e.g. "[popcat]". */
  logTag?: string;
}

/**
 * Resolves the image URL to operate on using the standard priority order.
 * Returns null when no usable image exists.
 */
export async function resolveImageUrl(
  ctx: AppCtx,
  options: ImageResolutionOptions = {},
): Promise<string | null> {
  const event = ctx.event;

  const direct = (event['attachments'] as RawAttachment[] | undefined) ?? [];
  const fromDirect = direct.find((att) => att?.url && isImageAttachment(att));
  if (fromDirect?.url) return fromDirect.url;

  const reply = event['messageReply'] as
    Record<string, unknown> | null | undefined;

  const replyAttachments =
    (reply?.['attachments'] as RawAttachment[] | undefined) ?? [];
  const fromReply = replyAttachments.find(
    (att) => att?.url && isImageAttachment(att),
  );
  if (fromReply?.url) return fromReply.url;

  const platform = ctx.native.platform;
  if (platform !== Platforms.Discord && platform !== Platforms.Telegram) {
    return null;
  }

  const replySenderID = reply?.['senderID'] as string | undefined;
  const senderID = replySenderID || (event['senderID'] as string | undefined);
  if (!senderID) return null;

  try {
    return await ctx.api.getAvatarUrl(senderID);
  } catch (err) {
    if (options.logAvatarFailure) {
      logger.warn(
        `${options.logTag ?? '[image]'} Avatar fallback lookup failed`,
        {
          senderID,
          platform,
          error: err,
        },
      );
    }
    return null;
  }
}

/** Best-effort avatar lookup for the invoking user, swallowing unsupported platforms. */
export async function tryResolveSenderAvatar(
  ctx: AppCtx,
): Promise<string | undefined> {
  const platform = ctx.native.platform;
  if (platform !== Platforms.Discord && platform !== Platforms.Telegram) {
    return undefined;
  }

  const senderID = ctx.event['senderID'] as string | undefined;
  if (!senderID) return undefined;

  try {
    return (await ctx.api.getAvatarUrl(senderID)) ?? undefined;
  } catch {
    return undefined;
  }
}
