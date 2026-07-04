/**
 * /dagd — da.gd Shortener
 *
 * Shortens a URL via the Delirius proxy for da.gd. Unlike the other
 * shortener endpoints, da.gd nests the link under `data.short` rather than
 * returning `data` as a bare string.
 *
 * Flow:
 *   User: /dagd https://www.delirius.store
 *   Bot:  🔗 da.gd Shortener
 *         🔸 Original: https://www.delirius.store
 *         🔹 Shortened: https://da.gd/...
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

interface DagdShortenResponse {
  status: boolean;
  creator?: string;
  data?: { short?: string };
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
  const url = createUrl('delirius', '/shorten/dagd', { url: targetUrl });
  console.log('[dagd] → GET', url);

  try {
    const { status, data } = await axios.get<DagdShortenResponse>(url, {
      headers: { Accept: 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (status < 200 || status >= 300 || !data || data.status !== true) {
      console.error('[dagd] ✗ bad response', { status, apiStatus: data?.status });
      return null;
    }

    console.log('[dagd] ✓ success for', targetUrl);
    return data.data?.short ?? null;
  } catch (err) {
    const error = err as AxiosError;
    console.error('[dagd] ✗ request failed:', error.code ?? error.message);
    return null;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'dagd',
  aliases: ['da.gd'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Shorten a URL using da.gd.',
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
      `🔗 **da.gd Shortener**\n` +
      `🔸 **Original:** ${rawUrl}\n` +
      `🔹 **Shortened:** ${shortUrl}`,
  });
};
