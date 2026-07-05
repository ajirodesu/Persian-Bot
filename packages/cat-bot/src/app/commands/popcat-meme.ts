/**
 * Popcat Two-Panel Memes — multi-command family (single file, config-driven)
 *
 * Same architecture as popcat.ts / popcat-text.ts / popcat-media.ts: one
 * EFFECT_CONFIGS table declares each endpoint (path, label, example text
 * for both panels), and one shared runEffect() dispatches on that config.
 * Adding another two-panel meme later means appending one config object —
 * no new onCommand function required.
 *
 * Every endpoint takes a `text1` / `text2` pair and responds with the raw
 * image bytes directly (no JSON envelope), so a shared downloader validates
 * the response before attaching it.
 *
 * Commands:
 *   /drake  — Drake disapprove/approve meme
 *   /pooh   — Regular Pooh / Fancy Pooh meme
 *
 * Flow (per command):
 *   User: /drake amongus | amogus
 *   Bot:  [effect-rendered image]
 *
 * If invoked with no "|" pair but as a reply to a message, that message's
 * text is used as text2 (top/first panel is left for the caller to type),
 * mirroring the reply-fallback convention used by other text-input
 * commands (see say.ts, popcat-text.ts).
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta, CommandOption } from '@/engine/types/module-config.types.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { createUrl, type UrlParams } from '@/engine/lib/apis.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// ── Outbound request headers ─────────────────────────────────────────────────
//
// A standard desktop User-Agent/Accept pair avoids basic bot-protection
// rejections some free API providers apply to headerless requests.
const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'image/*,*/*;q=0.8',
};

/** Best-effort decode of a non-2xx response body for diagnostics. */
function describeErrorBody(data: ArrayBuffer): string {
  try {
    const text = Buffer.from(data).toString('utf8').trim().slice(0, 300);
    if (!text) return '(empty body)';
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const reason = parsed['message'] ?? parsed['error'] ?? parsed['msg'];
      if (typeof reason === 'string') return reason;
    } catch {
      // not JSON — fall through to raw text
    }
    return text;
  } catch {
    return '(unreadable body)';
  }
}

/** Picks a sensible file extension from the response Content-Type header. */
function extFromContentType(contentType: unknown): string {
  const type = String(contentType ?? '').toLowerCase();
  if (type.includes('gif')) return 'gif';
  if (type.includes('webp')) return 'webp';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  return 'png';
}

/**
 * Downloads the rendered meme image ourselves (rather than handing a bare
 * URL to attachment_url) so a non-2xx response is caught and reported here
 * with a clear, per-command message.
 */
async function fetchRenderedImage(
  requestUrl: string,
  context: string,
  label: string,
): Promise<{ buffer: Buffer; ext: string }> {
  const response = await axios.get<ArrayBuffer>(requestUrl, {
    responseType: 'arraybuffer',
    timeout: 30_000,
    headers: REQUEST_HEADERS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    const reason = describeErrorBody(response.data);
    logger.warn(
      `[popcat-meme] ${label} failed (status ${response.status}): ${reason} | request=${requestUrl} | context=${context}`,
    );
    throw new Error(`${label} API responded with status ${response.status}: ${reason}`);
  }

  const buffer = Buffer.from(response.data);
  if (!buffer.length) throw new Error(`${label} API returned an empty image`);

  return { buffer, ext: extFromContentType(response.headers['content-type']) };
}

// ── Config table ──────────────────────────────────────────────────────────────

interface EndpointConfig {
  /** Command name — also the API path segment under /v2/. */
  name: string;
  /** Full path appended to the popcat base URL. */
  path: string;
  /** Display label used in reply messages / error text. */
  label: string;
  description: string;
  /** Example values shown in usage/option hints. */
  example1: string;
  example2: string;
  aliases?: string[];
}

const EFFECT_CONFIGS: EndpointConfig[] = [
  {
    name: 'drake',
    path: '/v2/drake',
    label: 'Drake',
    description: 'Render the Drake disapprove/approve meme.',
    example1: 'amongus',
    example2: 'amogus',
  },
  {
    name: 'pooh',
    path: '/v2/pooh',
    label: 'Pooh',
    description: 'Render the regular Pooh / fancy Pooh meme.',
    example1: 'making a discord bot',
    example2: 'making an api',
    aliases: ['poohmeme'],
  },
];

// ── Shared handler ────────────────────────────────────────────────────────────

async function runEffect(ctx: AppCtx, config: EndpointConfig): Promise<void> {
  const { chat, event, args, usage } = ctx;

  const messageReply = event['messageReply'] as
    | Record<string, unknown>
    | null
    | undefined;

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

  const params: UrlParams = { text1, text2 };

  try {
    const requestUrl = createUrl('popcat', config.path, params);
    const { buffer, ext } = await fetchRenderedImage(
      requestUrl,
      `${text1} | ${text2}`,
      config.label,
    );

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **${config.label}**`,
      attachment: [{ name: `${config.name}.${ext}`, stream: buffer }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to generate the image: \`${message}\``,
    });
  }
}

// ── Dynamic meta generation ──────────────────────────────────────────────────

function buildOptions(config: EndpointConfig): CommandOption[] {
  return [
    {
      type: OptionType.string,
      name: 'text1',
      description: `First panel text (e.g. "${config.example1}")`,
      required: true,
    },
    {
      type: OptionType.string,
      name: 'text2',
      description: `Second panel text (e.g. "${config.example2}")`,
      required: true,
    },
  ];
}

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = EFFECT_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases ?? [],
    version: '1.0.0',
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: config.description,
    category: 'image',
    usage: `<text1> | <text2> (or reply for text2)`,
    cooldown: 8,
    hasPrefix: true,
    options: buildOptions(config),
  },
  onCommand: async (ctx: AppCtx) => runEffect(ctx, config),
}));