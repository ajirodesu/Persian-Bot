/**
 * Popcat Avatar Service — shared implementation for the avatar-based image
 * effects family (14 commands).
 *
 * Every entry sends the resolved image URL to api.popcat.xyz/v2/<effect> and
 * returns the rendered result as an image attachment. Image resolution follows
 * the standard priority order: direct attachment → replied attachment →
 * replied user's avatar → caller's own avatar.
 */

import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { resolveImageUrl } from './image-input.service.js';
import { createMessageDelivery } from './message-delivery.service.js';

export const NO_AVATAR_IMAGE_MESSAGE =
  '📎 **Missing image.** Send a photo with this command, reply to one, reply to a user, or make sure your profile has an avatar set.';

export interface PopcatAvatarConfig {
  name: string;
  path: string;
  label: string;
}

/** Runs the shared avatar-effect flow for a family config. */
export async function runPopcatAvatar(
  ctx: AppCtx,
  config: PopcatAvatarConfig,
): Promise<void> {
  const imageUrl = await resolveImageUrl(ctx, {
    logAvatarFailure: true,
    logTag: '[popcat]',
  });

  if (!imageUrl) {
    await ctx.chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: NO_AVATAR_IMAGE_MESSAGE,
    });
    return;
  }

  const delivery = createMessageDelivery(ctx, { fallbackOnEditFailure: true });

  try {
    const requestUrl = createUrl('popcat', config.path, { image: imageUrl });

    await delivery.deliver({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **${config.label}**`,
      attachment_url: [{ name: `${config.name}.png`, url: requestUrl }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await delivery.fail(`⚠️ Failed to generate the image: \`${message}\``);
  }
}
