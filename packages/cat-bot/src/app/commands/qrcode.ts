/**
 * qrcode.ts — /qrcode — QR Code Generator
 *
 * Generates a QR code PNG from the provided text/URL using the free
 * goQR.me API (https://api.qrserver.com). Adapted from
 * mrepol742/project-canis into Cat-Bot's native module contract
 * (meta + onCommand).
 *
 *   /qrcode https://example.com
 *   Bot: [QR image attachment]
 *
 * The PNG is downloaded with browser headers + retry and sent as a photo.
 *
 * Author: AjiroDesu
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import type { NamedStreamAttachment } from '@/engine/adapters/models/interfaces/index.js';
import { withRetry, isNetworkError } from '@/engine/lib/retry.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

/** Generous cap on the length of the text to encode. */
const MAX_DATA_LENGTH = 1_000;
/** Pixels per side — large enough for reliable scanning while keeping the file small. */
const QR_SIZE = 300;

const QR_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'image/png,*/*;q=0.9',
};

/** Hard cap on the downloaded QR PNG. */
const MAX_QR_BYTES = 5 * 1024 * 1024; // 5 MB

// ── Download ──────────────────────────────────────────────────────────────

/**
 * Downloads the generated QR PNG into a Buffer with browser headers and
 * retry on transient network errors. Returns null when the download fails so
 * the caller can surface a friendly error.
 */
async function downloadQr(url: string): Promise<Buffer | null> {
  try {
    return await withRetry(
      async () => {
        const res = await axios.get<ArrayBuffer>(url, {
          timeout: 15_000,
          headers: QR_HEADERS,
          responseType: 'arraybuffer',
          maxContentLength: MAX_QR_BYTES,
          maxBodyLength: MAX_QR_BYTES,
          validateStatus: (status) => status >= 200 && status < 300,
        });
        const buf = Buffer.from(res.data);
        return buf.length === 0 ? null : buf;
      },
      {
        maxAttempts: 3,
        initialDelayMs: 500,
        maxDelayMs: 2_000,
        shouldRetry: (err) => isNetworkError(err),
      },
    );
  } catch (err) {
    logger.warn(`[qrcode] download failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── Config ────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'qrcode',
  aliases: ['qr'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate a QR code from the provided text.',
  category: 'Utility',
  usage: '<text or link>',
  cooldown: 5,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram, Platforms.Fluxer],
  options: [
    {
      type: OptionType.string,
      name: 'text',
      description: 'Text or URL to encode into a QR code',
      required: true,
    },
  ],
};

// ── Command Handler ───────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, args, usage } = ctx;

  if (!args.length) {
    await usage();
    return;
  }

  const data = args.join(' ').trim();

  if (data.length > MAX_DATA_LENGTH) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Text is too long. Please keep it under **${MAX_DATA_LENGTH.toLocaleString('en-US')} characters**.`,
    });
    return;
  }

  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${QR_SIZE}x${QR_SIZE}&data=${encodeURIComponent(data)}`;
  const buffer = await downloadQr(url);

  if (!buffer) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '⚠️ Failed to generate the QR code. Please try again.',
    });
    return;
  }

  const attachment: NamedStreamAttachment[] = [
    { name: `qrcode_${QR_SIZE}x${QR_SIZE}.png`, stream: buffer },
  ];

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: `🔳 **QR Code** for:\n\`${data}\``,
    attachment,
  });
};