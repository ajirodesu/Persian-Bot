/**
 * /countrynum — Phone Number Country Lookup
 *
 * Identifies the country and line type of a phone number via the Delirius
 * `country` endpoint.
 *
 * Flow:
 *   User: /countrynum +34613288116
 *   Bot:  🌍 Phone Number Lookup
 *         🇪🇸 Country: Spain
 *         ...
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

interface CountryLookupResult {
  country?: string;
  code?: string;
  emoji?: string;
  number?: string;
  type?: string;
}

interface CountryLookupResponse {
  status: boolean;
  creator?: string;
  result?: CountryLookupResult;
}

// ── Validation ────────────────────────────────────────────────────────────────

function isValidPhoneNumber(value: string): boolean {
  return /^\+?[0-9][0-9\s-]{5,14}$/.test(value.trim());
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchCountryInfo(
  phoneNumber: string,
): Promise<CountryLookupResult | null> {
  const url = createUrl('delirius', '/tools/country', { text: phoneNumber });
  console.log('[countrynum] → GET', url);

  try {
    const { status, data } = await axios.get<CountryLookupResponse>(url, {
      headers: { Accept: 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (status < 200 || status >= 300 || !data || data.status !== true) {
      console.error('[countrynum] ✗ bad response', { status, apiStatus: data?.status });
      return null;
    }

    console.log('[countrynum] ✓ success for', phoneNumber);
    return data.result ?? null;
  } catch (err) {
    const error = err as AxiosError;
    console.error('[countrynum] ✗ request failed:', error.code ?? error.message);
    return null;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'countrynum',
  aliases: ['numlookup', 'phonelookup'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Identify the country and type of a phone number.',
  category: 'tools',
  usage: '<phone_number>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Entry point ───────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, args, usage } = ctx;
  const phoneNumber = args[0]?.trim();

  if (!phoneNumber || !isValidPhoneNumber(phoneNumber)) {
    await usage();
    return;
  }

  const result = await fetchCountryInfo(phoneNumber);

  if (!result) {
    await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: GENERIC_ERROR });
    return;
  }

  const message =
    `🌍 **Phone Number Lookup**\n` +
    `${result.emoji ?? '🏳️'} **Country:** ${result.country ?? 'N/A'}\n` +
    `🔢 **Code:** ${result.code ?? 'N/A'}\n` +
    `📞 **Number:** ${result.number ?? phoneNumber}\n` +
    `📡 **Type:** ${result.type ?? 'N/A'}`;

  await chat.replyMessage({ style: MessageStyle.MARKDOWN, message });
};
