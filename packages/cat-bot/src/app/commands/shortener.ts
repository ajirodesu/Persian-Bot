/**
 * URL Shorteners — multi-command family (single file)
 *
 * Replaces the standalone dagd.ts, isgd.ts, short.ts, shorten.ts, tinurl.ts,
 * and vurl.ts files. Every one of them hit the same Delirius shortener proxy
 * (just a different backend service per endpoint) with identical validation,
 * fetch, and reply logic — so they're expressed here as one `runShortener()`
 * handler + a small config table, registered via the `commands` array export
 * that engine/app.ts's loadCommands() natively supports.
 *
 * da.gd is the one outlier: its result is nested under `data.short` instead
 * of `data` being the bare short-URL string, so the config table carries a
 * `nested` flag the shared fetcher branches on.
 *
 * Flow (per command):
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

interface ShortenResponse {
  status: boolean;
  creator?: string;
  data?: string | { short?: string };
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

// ── Config table ──────────────────────────────────────────────────────────────

interface ShortenerConfig {
  name: string;
  aliases: string[];
  endpoint: string;
  label: string;
  description: string;
  /** da.gd nests the short URL under data.short rather than data being a bare string. */
  nested?: boolean;
}

const SHORTENER_CONFIGS: ShortenerConfig[] = [
  {
    name: 'dagd',
    aliases: [],
    endpoint: '/shorten/dagd',
    label: 'da.gd Shortener',
    description: 'Shorten a URL using da.gd.',
    nested: true,
  },
  {
    name: 'isgd',
    aliases: [],
    endpoint: '/shorten/isgd',
    label: 'is.gd Shortener',
    description: 'Shorten a URL using is.gd.',
  },
  {
    name: 'short',
    aliases: ['googleshort'],
    endpoint: '/shorten/googleshort',
    label: 'Google Shortener',
    description: "Shorten a URL using Google's shortener service.",
  },
  {
    name: 'shorten',
    aliases: ['shortener'],
    endpoint: '/shorten/shorten',
    label: 'Shortener',
    description: 'Shorten a URL using the default recommended shortener service.',
  },
  {
    name: 'tinurl',
    aliases: ['tinyurl'],
    endpoint: '/shorten/tinyurl',
    label: 'TinyURL Shortener',
    description: 'Shorten a URL using TinyURL.',
  },
  {
    name: 'vurl',
    aliases: [],
    endpoint: '/shorten/vurl',
    label: 'vURL Shortener',
    description: 'Shorten a URL using vURL.',
  },
];

// ── Shared fetcher ────────────────────────────────────────────────────────────

async function fetchShortUrl(
  config: ShortenerConfig,
  targetUrl: string,
): Promise<string | null> {
  const url = createUrl('delirius', config.endpoint, { url: targetUrl });
  console.log(`[${config.name}] → GET`, url);

  try {
    const { status, data } = await axios.get<ShortenResponse>(url, {
      headers: { Accept: 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (status < 200 || status >= 300 || !data || data.status !== true) {
      console.error(`[${config.name}] ✗ bad response`, {
        status,
        apiStatus: data?.status,
      });
      return null;
    }

    const raw = data.data;
    const result = config.nested
      ? typeof raw === 'object' && raw ? raw.short : undefined
      : typeof raw === 'string' ? raw : undefined;

    console.log(`[${config.name}] ✓ success for`, targetUrl);
    return typeof result === 'string' ? result : null;
  } catch (err) {
    const error = err as AxiosError;
    console.error(`[${config.name}] ✗ request failed:`, error.code ?? error.message);
    return null;
  }
}

// ── Shared handler ────────────────────────────────────────────────────────────

async function runShortener(ctx: AppCtx, config: ShortenerConfig): Promise<void> {
  const { chat, args, usage } = ctx;
  const rawUrl = args[0]?.trim();

  if (!rawUrl || !isValidHttpUrl(rawUrl)) {
    await usage();
    return;
  }

  const shortUrl = await fetchShortUrl(config, rawUrl);

  if (!shortUrl) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: GENERIC_ERROR,
    });
    return;
  }

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message:
      `🔗 **${config.label}**\n` +
      `🔸 **Original:** ${rawUrl}\n` +
      `🔹 **Shortened:** ${shortUrl}`,
  });
}

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = SHORTENER_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases,
    version: '1.0.0',
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: config.description,
    category: 'tools',
    usage: '<url>',
    cooldown: 5,
    hasPrefix: true,
  },
  onCommand: async (ctx: AppCtx) => runShortener(ctx, config),
}));
