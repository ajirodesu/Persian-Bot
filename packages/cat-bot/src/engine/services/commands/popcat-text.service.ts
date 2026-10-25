/**
 * Popcat Text Service — shared implementation for the text-rendered image
 * effects family.
 *
 * Each endpoint sends the user's text to api.popcat.xyz/v2/<effect>?text= and
 * forwards the rendered result URL through `attachment_url` — the bot never
 * downloads the bytes. If invoked with no text but as a reply to a message,
 * the replied-to message's text is used instead.
 */

import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { createMessageDelivery } from './message-delivery.service.js';

export interface PopcatTextConfig {
  name: string;
  path: string;
  label: string;
}

/** Runs the shared text-effect flow for a family config. */
export async function runPopcatText(
  ctx: AppCtx,
  config: PopcatTextConfig,
): Promise<void> {
  const { event, args, usage } = ctx;

  const messageReply = event['messageReply'] as
    Record<string, unknown> | null | undefined;

  // Text-first, falling back to the replied-to message's text when the
  // command itself was invoked with no arguments.
  const typed = args.join(' ').trim();
  const text = typed || ((messageReply?.['message'] as string) ?? '').trim();

  if (!text) {
    await usage();
    return;
  }

  const delivery = createMessageDelivery(ctx, { fallbackOnEditFailure: true });

  try {
    const requestUrl = createUrl('popcat', config.path, { text });

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
