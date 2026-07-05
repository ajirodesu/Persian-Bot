/**
 * Popcat Text Effects — multi-command family (single file)
 *
 * Every entry sends the user's text to a api.popcat.xyz/v2/<effect>?text=
 * endpoint and returns the rendered result as an image attachment. Every
 * endpoint responds with the raw image bytes directly (no JSON envelope),
 * so the shared handler just downloads and verifies that response before
 * attaching it.
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand }>` and registers each entry
 * exactly like a standalone command module.
 *
 * Flow (per command):
 *   User: /alert Something happened
 *   Bot:  [effect-rendered image]
 *
 * If the command is invoked with no text but is a reply to a message, the
 * replied-to message's text is used instead (mirrors the reply-fallback
 * convention used by other text-input commands, e.g. say.ts).
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
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
 * Downloads the rendered effect image ourselves (rather than handing a bare
 * URL to attachment_url) so a non-2xx response is caught and reported here
 * with a clear, per-command message.
 */
async function fetchEffectImage(
  requestUrl: string,
  sourceText: string,
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
      `[popcat-text] ${label} failed (status ${response.status}): ${reason} | request=${requestUrl} | text=${sourceText}`,
    );
    throw new Error(`${label} API responded with status ${response.status}: ${reason}`);
  }

  const buffer = Buffer.from(response.data);
  if (!buffer.length) throw new Error(`${label} API returned an empty image`);

  return { buffer, ext: extFromContentType(response.headers['content-type']) };
}

// ── Config table ──────────────────────────────────────────────────────────────

interface EffectConfig {
  name: string;
  path: string;
  label: string;
  description: string;
  example: string;
}

const EFFECT_CONFIGS: EffectConfig[] = [
  {
    name: 'alert',
    path: '/v2/alert',
    label: 'Alert',
    description: 'Render text as an iOS-style alert popup.',
    example: 'Something happened',
  },
  {
    name: 'biden',
    path: '/v2/biden',
    label: 'Biden Tweet',
    description: 'Render text as a Joe Biden tweet meme.',
    example: 'pop cat is horni',
  },
  {
    name: 'caution',
    path: '/v2/caution',
    label: 'Caution',
    description: 'Render text on a yellow caution sign.',
    example: 'Wet floor',
  },
  {
    name: 'couldread',
    path: '/v2/couldread',
    label: 'Could Read',
    description: 'Render text as a "bet you could read that" meme.',
    example: 'Never Gonna Give You Up',
  },
  {
    name: 'facts',
    path: '/v2/facts',
    label: 'Facts',
    description: 'Render text as a "facts" meme card.',
    example: 'Cats are liquid',
  },
  {
    name: 'pikachu',
    path: '/v2/pikachu',
    label: 'Pikachu',
    description: 'Render text as the surprised Pikachu meme caption.',
    example: 'hello',
  },
];

// ── Shared handler ────────────────────────────────────────────────────────────

async function runEffect(
  ctx: AppCtx,
  config: EffectConfig,
): Promise<void> {
  const { chat, event, args, usage } = ctx;

  const messageReply = event['messageReply'] as
    | Record<string, unknown>
    | null
    | undefined;

  // Text-first, falling back to the replied-to message's text when the
  // command itself was invoked with no arguments.
  const typed = args.join(' ').trim();
  const text = typed || ((messageReply?.['message'] as string) ?? '').trim();

  if (!text) {
    await usage();
    return;
  }

  try {
    const requestUrl = createUrl('popcat', config.path, { text });
    const { buffer, ext } = await fetchEffectImage(requestUrl, text, config.label);

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

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = EFFECT_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: [],
    version: '1.0.0',
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: config.description,
    category: 'image',
    usage: '<text> (or reply to a message)',
    cooldown: 8,
    hasPrefix: true,
    options: [
      {
        type: OptionType.string,
        name: 'text',
        description: `Text to render (e.g. "${config.example}")`,
        required: true,
      },
    ],
  },
  onCommand: async (ctx: AppCtx) => runEffect(ctx, config),
}));