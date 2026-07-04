/**
 * /shorten — Multi-Shortener (primary alias)
 *
 * Shortens a URL via the Delirius proxy's default/recommended shortener
 * endpoint (currently backed by is.gd). Acts as the primary, easy-to-remember
 * entry point for the shortener family.
 *
 * Flow:
 *   User: /shorten https://www.delirius.store
 *   Bot:  🔗 Shortener
 *         🔸 Original: https://www.delirius.store
 *         🔹 Shortened: https://...
 */

import axios, { AxiosError } from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';

const REQUEST_TIMEOUT_MS = 15_000;
const GENERIC_ERROR =
  '⚠️ **Service temporarily unavailable.** Please try again in a moment.';

// ── Response shape ────────────────────────────────────────────────────────────

interface ShortenResponse {
  status: boolean;
  creator?: string;
  data?: string;
}

// ── Validation ────────────────────────────────────────────────────────────────

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchShortUrl(targetUrl: string): Promise<string | null> {
  const url = createUrl('delirius', '/shorten/shorten', { url: targetUrl });
  console.log('[shorten] → GET', url);

  try {
    const { status, data } = await axios.get<ShortenResponse>(url, {
      headers: { Accept: 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (status < 200 || status >= 300 || !data || data.status !== true) {
      console.error('[shorten] ✗ bad response', { status, apiStatus: data?.status });
      return null;
    }

    console.log('[shorten] ✓ success for', targetUrl);
    return typeof data.data === 'string' ? data.data : null;
  } catch (err) {
    const error = err as AxiosError;
    console.error('[shorten] ✗ request failed:', error.code ?? error.message);
    return null;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'shorten',
  aliases: ['shortener'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Shorten a URL using the default recommended shortener service.',
  category: 'tools',
  usage: '<url>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Entry point ───────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, args, usage } = ctx;
  const rawUrl = args[0]?.trim();

  if (!rawUrl || !isValidHttpUrl(rawUrl)) {
    await usage();
    return;
  }

  const shortUrl = await fetchShortUrl(rawUrl);

  if (!shortUrl) {
    await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: GENERIC_ERROR });
    return;
  }

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message:
      `🔗 **Shortener**\n` +
      `🔸 **Original:** ${rawUrl}\n` +
      `🔹 **Shortened:** ${shortUrl}`,
  });
};
