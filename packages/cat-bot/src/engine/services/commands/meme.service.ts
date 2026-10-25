/**
 * Meme Service — shared implementation for /meme and /animeme.
 *
 * Both commands hit meme-api.com with a different subreddit pool, retry stale
 * links a few times, and share the same refresh-button contract. Each command
 * keeps its own button definition bound to its own config, so /meme always
 * re-rolls from r/memes and /animeme from r/animemes.
 */

import axios from 'axios';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import { createMessageDelivery } from './message-delivery.service.js';

export const MEME_BUTTON_ID = 'refresh';

export interface MemeConfig {
  /** meme-api.com subreddit pool, e.g. "memes" or "animemes". */
  endpoint: string;
  /** Filename prefix for the attachment. */
  attachmentPrefix: string;
  /** Optional emoji/title prefix used in the caption. */
  titlePrefix: string;
}

interface MemeResult {
  url: string;
  title: string;
}

/** Fetches a random meme (URL + title) from the given meme-api.com subreddit pool. */
async function fetchRandomMeme(endpoint: string): Promise<MemeResult> {
  const { data } = await axios.get<{ url?: string; title?: string }>(
    `https://meme-api.com/gimme/${endpoint}`,
    { timeout: 10_000 },
  );
  if (!data?.url || !data?.title) throw new Error('Invalid meme data returned');
  return { url: data.url, title: data.title };
}

/** Runs the shared meme fetch/render flow for a family config. */
export async function runMeme(ctx: AppCtx, config: MemeConfig): Promise<void> {
  const { native, button, session } = ctx;
  const isButtonAction = ctx.event['type'] === 'button_action';
  const delivery = createMessageDelivery(ctx);

  // Reuse the active button instance ID on refresh so the button stays live;
  // otherwise mint a fresh one for the initial send. Computed once — stays the
  // same across every retry attempt below.
  const buttonId = isButtonAction
    ? session.id
    : button.generateID({ id: MEME_BUTTON_ID, public: true });

  // A meme-api.com link can go stale between being handed to us and the platform
  // actually fetching it — especially right after rapid refresh-button use. Quietly
  // re-roll a fresh meme a few times before surfacing an error.
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const meme = await fetchRandomMeme(config.endpoint);
      const extMatch = meme.url.match(/\.(jpe?g|png|gif|webp)(\?|$)/i);
      const ext = extMatch?.[1] ?? 'jpg';

      await delivery.deliver({
        style: MessageStyle.MARKDOWN,
        message: `${config.titlePrefix}**${meme.title}**`,
        attachment_url: [
          { name: `${config.attachmentPrefix}.${ext}`, url: meme.url },
        ],
        ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
      });
      return;
    } catch (err) {
      lastError = err;
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : 'Unknown error';
  await delivery.fail(`⚠️ Failed to fetch a meme: ${message}`);
}

export interface MemeButtonDefinition {
  label: string;
  style: (typeof ButtonStyle)[keyof typeof ButtonStyle];
  onClick: (ctx: AppCtx) => Promise<void>;
}

/** Builds the refresh button for a family config. */
export function createMemeButton(
  config: MemeConfig,
  label: string,
): Record<string, MemeButtonDefinition> {
  return {
    [MEME_BUTTON_ID]: {
      label,
      style: ButtonStyle.PRIMARY,
      onClick: async (ctx: AppCtx): Promise<void> => runMeme(ctx, config),
    },
  };
}
