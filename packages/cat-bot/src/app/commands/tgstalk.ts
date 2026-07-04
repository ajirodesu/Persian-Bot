/**
 * /tgstalk — Telegram User Info Lookup
 *
 * Fetches a target user's public Telegram profile via the Delirius
 * `telegramstalk` endpoint and renders it as a clean, formatted card,
 * attaching the profile photo when one is available.
 *
 * Flow:
 *   User: /tgstalk AjiroDesu
 *   Bot:  [profile photo]
 *         👤 Telegram Profile
 *         🆔 ID: ...
 *         📛 Username: @AjiroDesu
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

interface TelegramStalkProfile {
  id?: string | number;
  username?: string;
  name?: string;
  premium?: boolean;
  verified?: boolean;
  photo?: string;
}

interface TelegramStalkResponse {
  status: boolean;
  creator?: string;
  profile?: TelegramStalkProfile;
}

// ── Validation ────────────────────────────────────────────────────────────────

function isValidUsername(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value.replace(/^@/, ''));
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchTelegramProfile(
  username: string,
): Promise<TelegramStalkProfile | null> {
  const url = createUrl('delirius', '/tools/telegramstalk', { username });
  console.log('[tgstalk] → GET', url);

  try {
    const { status, data } = await axios.get<TelegramStalkResponse>(url, {
      headers: { Accept: 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (status < 200 || status >= 300 || !data || data.status !== true) {
      console.error('[tgstalk] ✗ bad response', { status, apiStatus: data?.status });
      return null;
    }

    console.log('[tgstalk] ✓ success for', username);
    return data.profile ?? null;
  } catch (err) {
    const error = err as AxiosError;
    console.error('[tgstalk] ✗ request failed:', error.code ?? error.message);
    return null;
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

function yesNo(value: unknown): string {
  return value === true ? '✅ Yes' : value === false ? '❌ No' : '❔ Unknown';
}

function formatProfile(profile: TelegramStalkProfile): string {
  return (
    `👤 **Telegram Profile**\n` +
    `🆔 **ID:** ${profile.id ?? 'N/A'}\n` +
    `📛 **Username:** ${profile.username ? `@${profile.username}` : 'N/A'}\n` +
    `🏷️ **Name:** ${profile.name ?? 'N/A'}\n` +
    `⭐ **Premium:** ${yesNo(profile.premium)}\n` +
    `☑️ **Verified:** ${yesNo(profile.verified)}`
  );
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'tgstalk',
  aliases: ['telegramstalk', 'tgcheck'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: "Look up a Telegram user's public profile information.",
  category: 'tools',
  usage: '<username>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Entry point ───────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, args, usage } = ctx;
  const username = args[0]?.trim().replace(/^@/, '');

  if (!username || !isValidUsername(username)) {
    await usage();
    return;
  }

  const profile = await fetchTelegramProfile(username);

  if (!profile) {
    await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: GENERIC_ERROR });
    return;
  }

  const caption = formatProfile(profile);

  if (profile.photo) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment_url: [{ name: 'tgstalk.jpg', url: profile.photo }],
    });
  } else {
    await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: caption });
  }
};
