/**
 * Popcat Converter Service — shared implementation for the text-converter
 * family.
 *
 * Every endpoint responds with `{ error: boolean, message: { text: string } }`.
 * The input is sent under the provider's own query-param name (e.g. "text" or
 * "binary"), and the converted text is rendered under the family label.
 */

import axios from 'axios';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

interface ConverterEnvelope {
  error: boolean;
  message?: { text?: string };
}

export interface ConverterConfig {
  name: string;
  path: string;
  /** Name of the query param the input string is sent under (e.g. "text", "binary"). */
  paramName: string;
  label: string;
  emoji: string;
}

async function fetchConversion(
  config: ConverterConfig,
  input: string,
): Promise<string> {
  const requestUrl = createUrl('popcat', config.path, {
    [config.paramName]: input,
  });

  const { data } = await axios.get<ConverterEnvelope>(requestUrl, {
    timeout: 10_000,
    headers: { Accept: 'application/json' },
    validateStatus: () => true,
  });

  const text = data?.message?.text;
  if (data?.error || !text) {
    throw new Error(`${config.label} API returned no result`);
  }

  return text;
}

/** Runs the shared converter flow for a family config. */
export async function runConverter(
  ctx: AppCtx,
  config: ConverterConfig,
): Promise<void> {
  const { chat, args, usage } = ctx;

  const input = args.join(' ').trim();
  if (!input) {
    await usage();
    return;
  }

  try {
    const result = await fetchConversion(config, input);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `${config.emoji} **${config.label}**\n\n${result}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[popcat-conventer] ${config.name} failed: ${message}`);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to ${config.label.toLowerCase()}: \`${message}\``,
    });
  }
}
