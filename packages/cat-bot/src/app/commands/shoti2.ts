/**
 * /shotiv2 — Random TikTok Video (Aqua API)
 *
 * Second-generation "shoti" command, sourced from the Aqua API instead of
 * the Betadash endpoint that /shoti (shoti.ts) uses. Kept as a separate
 * command rather than replacing /shoti so both providers stay available
 * as independent fallbacks for each other.
 *
 * API: registered as 'aqua' in @/engine/lib/apis.lib.js
 *       (base https://aqua-api-w6dy.onrender.com)
 *   GET /random/shoti
 *
 * Response shape:
 *   {
 *     operator:      string
 *     timestamp:     string  (ISO date)
 *     responseTime:  string  ("3912ms")
 *     type:          string  ("video")
 *     shotiType:     string  ("video")
 *     user: {
 *       instagram:   string  (may be "")
 *       nickname:    string
 *       signature:   string  (bio text, may be "")
 *       twitter:     string  (may be "")
 *       username:    string
 *     }
 *     media:         string[] (direct playable video URL(s))
 *     duration:      string   (milliseconds, as a numeric string)
 *     region:        string
 *     shoti_id:      string
 *     shoti_score:   number
 *     title:         string
 *   }
 *
 * Uses withLoadingMedia() for the standard "loading → swap in place" flow
 * (single round trip on refresh instead of delete+resend), and attaches a
 * persistent "🔁 More Shoti" button on platforms with native button support
 * so the user can fetch another random video in-place without re-issuing
 * the command.
 *
 * Aliases: /shoti2
 * Access:  ANYONE
 * Cooldown: 10s
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { withLoadingMedia } from '@/engine/utils/media-loading.util.js';

// ── API constants ──────────────────────────────────────────────────────────────

const API_URL = createUrl('aqua', '/random/shoti', {});

/** Maximum wait for the metadata fetch step (ms). */
const FETCH_TIMEOUT_MS = 20_000;

// ── API response type ────────────────────────────────────────────────────────

interface ShotiV2User {
  instagram: string;
  nickname: string;
  signature: string;
  twitter: string;
  username: string;
}

interface ShotiV2Response {
  operator: string;
  timestamp: string;
  responseTime: string;
  type: string;
  shotiType: string;
  user: ShotiV2User;
  media: string[];
  duration: string;
  region: string;
  shoti_id: string;
  shoti_score: number;
  title: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** "9567" (ms, as a string) → "0:09" */
function formatDuration(durationMs: string): string {
  const totalSeconds = Math.floor((Number(durationMs) || 0) / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Fetches a random shoti video's metadata from the Aqua API. */
async function fetchRandomShoti(): Promise<ShotiV2Response> {
  const res = await fetch(API_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(
      `Shoti API returned HTTP ${res.status} — the service may be temporarily unavailable.`,
    );
  }
  const data = (await res.json()) as ShotiV2Response;
  if (!data?.media?.[0]) {
    throw new Error('No video was returned. Try again in a moment.');
  }
  return data;
}

// ── Command configuration ────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'shotiv2',
  aliases: ['shoti2'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Sends a random TikTok video (Aqua API).',
  category: 'Media',
  usage: '',
  cooldown: 10,
  hasPrefix: true,
};

// ── Button definition ─────────────────────────────────────────────────────────

const BUTTON_ID = { refresh: 'refresh' } as const;

export const button = {
  [BUTTON_ID.refresh]: {
    label: '🔁 More Shoti',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => runShotiV2(ctx),
  },
};

// ── Shared handler ────────────────────────────────────────────────────────────

/**
 * Shared send/edit logic used by both onCommand (fresh send) and the
 * button onClick (in-place refresh) — mirrors the /meme and /animeme pattern.
 */
async function runShotiV2(ctx: AppCtx): Promise<void> {
  const { native, button, session } = ctx;

  const loading = await withLoadingMedia(ctx, '🎲 **Fetching a random TikTok video...**');

  try {
    const shoti = await fetchRandomShoti();
    const { user, title, region, duration, media } = shoti;

    // Reuse the active button instance ID on refresh so the button stays live;
    // otherwise mint a fresh one for the initial send.
    const buttonId = loading.isButtonAction
      ? session.id
      : button.generateID({ id: BUTTON_ID.refresh, public: true });

    const displayTitle = title && title.trim() ? title : '_(no title)_';
    const bio = user.signature && user.signature.trim() ? user.signature : null;
    const socials = [
      user.instagram ? `IG: @${user.instagram}` : null,
      user.twitter ? `X: @${user.twitter}` : null,
    ].filter(Boolean);

    const caption = [
      `🎥 **Shoti**`,
      '',
      `👤 **Creator**: ${user.nickname} (@${user.username})`,
      `📝 **Title**: ${displayTitle}`,
      ...(bio ? [`💬 **Bio**: ${bio}`] : []),
      ...(socials.length ? [`🔗 **Socials**: ${socials.join(' | ')}`] : []),
      `🌍 **Region**: ${region}`,
      `⏱️ **Duration**: ${formatDuration(duration)}`,
    ].join('\n');

    await loading.finish({
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment_url: [{ name: 'shoti.mp4', url: media[0]! }],
      ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await loading.fail(`⚠️ Failed to fetch a Shoti video: ${message}`);
  }
}

export const onCommand = async (ctx: AppCtx): Promise<void> => runShotiV2(ctx);