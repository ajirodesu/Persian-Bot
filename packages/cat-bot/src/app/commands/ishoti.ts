/**
 * /ishoti — Random TikTok/Photo-Mode "Shoti" Image Set
 *
 * Image-only sibling of /shotiv2. Both hit the same Aqua API endpoint, which
 * returns EITHER a video result (shotiType: "video") OR a photo-set result
 * (shotiType: "image", media[] containing 2+ image URLs) at random. This
 * command specifically wants the photo variant, so it re-rolls the endpoint
 * internally (bounded by MAX_ROLLS) until it gets an image-type result,
 * rather than surfacing whatever the API happens to return first.
 *
 * API: registered as 'aqua' in @/engine/lib/apis.lib.js
 *       (base https://aqua-api-w6dy.onrender.com)
 *   GET /random/shoti
 *
 * Response shape (image variant):
 *   {
 *     operator:      string
 *     timestamp:     string  (ISO date)
 *     responseTime:  string  ("3424ms")
 *     type:          string  ("photo")
 *     shotiType:     string  ("image")
 *     user: {
 *       instagram:   string  (may be "")
 *       nickname:    string
 *       signature:   string  (bio text, may be "")
 *       twitter:     string  (may be "")
 *       username:    string
 *     }
 *     media:         string[] (2+ direct image URLs)
 *     duration:      string   ("0" for photo sets)
 *     region:        string
 *     shoti_id:      string
 *     shoti_score:   number
 *     title:         string   (often "")
 *   }
 *
 * Deliberately has NO refresh/repeat button — each invocation is a one-shot
 * send. Re-running the command (rather than clicking a button) is the only
 * way to get another set.
 *
 * Aliases: /shotiimg, /shotipic
 * Access:  ANYONE
 * Cooldown: 10s
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { withLoadingMedia } from '@/engine/utils/media-loading.util.js';

// ── API constants ──────────────────────────────────────────────────────────────

const API_URL = createUrl('aqua', '/random/shoti', {});

/** Maximum wait per metadata fetch attempt (ms). */
const FETCH_TIMEOUT_MS = 20_000;

/** How many times to re-roll the (random video-or-image) endpoint while
 *  waiting for an image-type result, before giving up. */
const MAX_ROLLS = 6;

/** Telegram's sendMediaGroup album cap. */
const MAX_IMAGES = 10;

// ── API response type ────────────────────────────────────────────────────────

interface ShotiUser {
  instagram: string;
  nickname: string;
  signature: string;
  twitter: string;
  username: string;
}

interface ShotiResponse {
  operator: string;
  timestamp: string;
  responseTime: string;
  type: string;
  shotiType: string;
  user: ShotiUser;
  media: string[];
  duration: string;
  region: string;
  shoti_id: string;
  shoti_score: number;
  title: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchShotiOnce(): Promise<ShotiResponse> {
  const res = await fetch(API_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(
      `Shoti API returned HTTP ${res.status} — the service may be temporarily unavailable.`,
    );
  }
  const data = (await res.json()) as ShotiResponse;
  if (!data?.media?.length) {
    throw new Error('No media was returned. Try again in a moment.');
  }
  return data;
}

/**
 * Re-rolls the (video-or-image, random) endpoint until an image-type result
 * comes back, up to MAX_ROLLS attempts.
 */
async function fetchRandomImageShoti(): Promise<ShotiResponse> {
  let lastNonImage: ShotiResponse | null = null;

  for (let attempt = 0; attempt < MAX_ROLLS; attempt++) {
    const data = await fetchShotiOnce();
    if (data.shotiType === 'image' || data.type === 'photo') return data;
    lastNonImage = data;
  }

  throw new Error(
    lastNonImage
      ? `Only video results came up after ${MAX_ROLLS} tries — try again in a moment.`
      : 'Could not fetch a result. Try again in a moment.',
  );
}

// ── Command configuration ────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'ishoti',
  aliases: ['shotiimg', 'shotipic'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Sends a random TikTok photo-mode image set (Aqua API).',
  category: 'Media',
  usage: '',
  cooldown: 10,
  hasPrefix: true,
};

// ── Command handler ──────────────────────────────────────────────────────────
// No `button` export — this command is intentionally one-shot, with no
// refresh/repeat action.

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const loading = await withLoadingMedia(ctx, '🎲 **Fetching a random photo set...**');

  try {
    const shoti = await fetchRandomImageShoti();
    const { user, title, region, media } = shoti;

    const images = media.slice(0, MAX_IMAGES);
    const displayTitle = title && title.trim() ? title : '_(no title)_';
    const bio = user.signature && user.signature.trim() ? user.signature : null;
    const socials = [
      user.instagram ? `IG: @${user.instagram}` : null,
      user.twitter ? `X: @${user.twitter}` : null,
    ].filter(Boolean);

    const caption = [
      `🖼️ **Shoti (Photo Set)**`,
      '',
      `👤 **Creator**: ${user.nickname} (@${user.username})`,
      `📝 **Title**: ${displayTitle}`,
      ...(bio ? [`💬 **Bio**: ${bio}`] : []),
      ...(socials.length ? [`🔗 **Socials**: ${socials.join(' | ')}`] : []),
      `🌍 **Region**: ${region}`,
      `🖼️ **Photos**: ${images.length}`,
    ].join('\n');

    await loading.finish({
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment_url: images.map((url, idx) => ({
        name: `shoti_${idx + 1}.jpg`,
        url,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await loading.fail(`⚠️ Failed to fetch a Shoti photo set: ${message}`);
  }
};