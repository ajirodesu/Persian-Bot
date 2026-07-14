/**
 * /emojimix — Emoji Mix Image Generator
 *
 * Combines two emojis into a single mashup image via the Delirius `mixed`
 * endpoint (Google's Emoji Kitchen). Percent-encoding is handled automatically
 * by URLSearchParams inside createUrl().
 *
 * Flow:
 *   User: /emojimix 😊 😝
 *   Bot:  [mixed emoji image]
 */

import axios, { AxiosError } from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { withLoadingMedia } from '@/engine/utils/media-loading.util.js';

const REQUEST_TIMEOUT_MS = 15_000;
const GENERIC_ERROR =
  '⚠️ **Service temporarily unavailable.** Please try again in a moment.';

// ── Response shape ────────────────────────────────────────────────────────────

interface EmojiMixResponse {
  status: boolean;
  creator?: string;
  data?: { url?: string };
}

// ── Validation ────────────────────────────────────────────────────────────────

function isSingleEmojiLike(value: string | undefined): value is string {
  return !!value && value.trim().length > 0 && !/\s/.test(value.trim());
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchEmojiMix(
  emoji1: string,
  emoji2: string,
): Promise<string | null> {
  const url = createUrl('delirius', '/tools/mixed', { emoji1, emoji2 });
  console.log('[emojimix] → GET', url);

  try {
    const { status, data } = await axios.get<EmojiMixResponse>(url, {
      headers: { Accept: 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (status < 200 || status >= 300 || !data || data.status !== true) {
      console.error('[emojimix] ✗ bad response', { status, apiStatus: data?.status });
      return null;
    }

    console.log('[emojimix] ✓ success for', emoji1, emoji2);
    return data.data?.url ?? null;
  } catch (err) {
    const error = err as AxiosError;
    console.error('[emojimix] ✗ request failed:', error.code ?? error.message);
    return null;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'emojimix',
  aliases: ['mixemoji'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Mix two emojis into a single combined image.',
  category: 'tools',
  usage: '<emoji1> <emoji2>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Entry point ───────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { args, usage } = ctx;
  const emoji1 = args[0]?.trim();
  const emoji2 = args[1]?.trim();

  if (!isSingleEmojiLike(emoji1) || !isSingleEmojiLike(emoji2)) {
    await usage();
    return;
  }

  const loading = await withLoadingMedia(ctx, `🎨 **Mixing ${emoji1} + ${emoji2}...**`);

  const imageUrl = await fetchEmojiMix(emoji1, emoji2);

  if (!imageUrl) {
    await loading.fail(GENERIC_ERROR);
    return;
  }

  await loading.finish({
    style: MessageStyle.MARKDOWN,
    message: `🎨 **Emoji Mix:** ${emoji1} + ${emoji2}`,
    attachment_url: [{ name: 'emojimix.png', url: imageUrl }],
  });
};
