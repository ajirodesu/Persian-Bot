/**
 * Popcat Two-Panel Meme Service — shared implementation for /drake and /pooh.
 *
 * Both endpoints take a `text1` / `text2` pair and serve the rendered meme back
 * via the result URL, which is forwarded directly through `attachment_url` —
 * the bot never downloads the bytes. If invoked with no "|" pair but as a
 * reply to a message, that message's text is used as text2.
 */

import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { createMessageDelivery } from './message-delivery.service.js';

export interface PopcatMemeConfig {
  /** Command name — also the API path segment under /v2/. */
  name: string;
  /** Full path appended to the popcat base URL. */
  path: string;
  /** Display label used in reply messages / error text. */
  label: string;
}

/** Runs the shared two-panel meme flow for a family config. */
export async function runPopcatMeme(
  ctx: AppCtx,
  config: PopcatMemeConfig,
): Promise<void> {
  const { event, args, usage } = ctx;

  const messageReply = event['messageReply'] as
    Record<string, unknown> | null | undefined;

  const rawInput = args.join(' ');
  const pipeIndex = rawInput.indexOf('|');

  let text1: string;
  let text2: string;

  if (pipeIndex !== -1) {
    text1 = rawInput.slice(0, pipeIndex).trim();
    text2 = rawInput.slice(pipeIndex + 1).trim();
  } else {
    // No "a | b" pair typed — treat the whole input as the first panel and
    // fall back to the replied-to message's text for the second panel.
    text1 = rawInput.trim();
    text2 = ((messageReply?.['message'] as string) ?? '').trim();
  }

  if (!text1 || !text2) {
    await usage();
    return;
  }

  const delivery = createMessageDelivery(ctx, { fallbackOnEditFailure: true });

  try {
    const requestUrl = createUrl('popcat', config.path, { text1, text2 });

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
