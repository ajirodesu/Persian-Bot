/**
 * /ishoti — Random TikTok Photo-Mode "Shoti" Image Set
 *
 * Hits the Aqua endpoint with `?type=photo` directly. A single call already
 * returns a full photo set — `media` typically comes back with several
 * image URLs (real sample: 7) — so this is one fetch, not a roll/aggregate
 * loop.
 *
 * API: registered as 'aqua' in @/engine/lib/apis.lib.js
 *       (base https://aqua-api-w6dy.onrender.com)
 *   GET /random/shoti?type=photo
 *
 * Response shape:
 *   {
 *     operator:      string
 *     timestamp:     string  (ISO date)
 *     responseTime:  string  ("1823ms")
 *     type:          string  ("photo")
 *     shotiType:     string  ("image")
 *     user: {
 *       instagram:   string  (may be "")
 *       nickname:    string
 *       signature:   string  (bio text, may be "")
 *       twitter:     string  (may be "")
 *       username:    string
 *     }
 *     media:         string[] (multiple direct image URLs, e.g. 7)
 *     duration:      string   ("0" for photo sets)
 *     region:        string
 *     shoti_id:      string
 *     shoti_score:   number
 *     title:         string   (often "")
 *   }
 *
 * ── Delivery ────────────────────────────────────────────────────────────
 * `media` URLs are passed straight through via attachment_url[] — the bot
 * never downloads them. Telegram forwards attachment_url entries to the Bot
 * API as plain URL strings, so Telegram's own servers fetch each image.
 * Discord routes them into embeds referencing the URL directly, so Discord's
 * own servers fetch the image for the preview. Either way, the image bytes
 * never pass through this process — no axios call, no buffering, no
 * IMAGE_DOWNLOAD_TIMEOUT_MS to tune.
 *
 * CAVEAT: imgbox (which hosts `media`) previously appeared to stall/hang
 * requests that arrive without a browser-like User-Agent when *this bot*
 * downloaded them directly. Whether Telegram's/Discord's own fetchers send a
 * User-Agent imgbox accepts is untested — if photos start showing up broken
 * or missing, that's the first thing to check; the fallback is downloading
 * with an explicit User-Agent locally (as this file used to) and sending via
 * attachment[] instead of attachment_url[].
 *
 * No loading placeholder message is sent — the typing indicator (started
 * automatically for the command's full processing duration and cleared the
 * instant the reply is sent) already covers that. The photo set is sent
 * directly as a single reply via chat.replyMessage(), whose Telegram adapter
 * batches multiple photo attachment_url entries into one sendMediaGroup
 * album call (see replyMessage.ts).
 *
 * No cap is applied to `media` — every photo URL the API returns is passed
 * through. A response with only 1 photo is a normal, valid result (confirmed
 * against a live sample) and is sent as-is — it is not treated as an error.
 *
 * No refresh button — a fresh /ishoti invocation is the only way to get
 * another set. Caption is just the creator's @username.
 *
 * Aliases: /shotiimg, /shotipic
 * Access:  ANYONE
 * Cooldown: 10s
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import type { NamedUrlAttachment } from '@/engine/adapters/models/interfaces/index.js';
import { createUrl } from '@/engine/lib/apis.lib.js';

// ── API constants ──────────────────────────────────────────────────────────────

const API_URL = createUrl('aqua', '/random/shoti', { type: 'photo' });

/** Maximum wait for the metadata fetch (ms). */
const FETCH_TIMEOUT_MS = 20_000;

// ── API response type ────────────────────────────────────────────────────────

interface ShotiUser {
  instagram: string;
  nickname: string;
  signature: string;
  twitter: string;
  username: string;
}

interface ShotiImageResponse {
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

/** Fetches a random Shoti photo set from the Aqua API. */
async function fetchShotiPhotos(): Promise<ShotiImageResponse> {
  const res = await fetch(API_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(
      `Shoti API returned HTTP ${res.status} — the service may be temporarily unavailable.`,
    );
  }
  const data = (await res.json()) as ShotiImageResponse;
  if (!data?.media?.length) {
    throw new Error('No media was returned. Try again in a moment.');
  }
  return data;
}

// ── Command configuration ────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'ishoti',
  aliases: ['shotiimg', 'shotipic'] as string[],
  version: '1.2.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Sends a random TikTok photo-mode image set (Aqua API).',
  category: 'Media',
  usage: '',
  cooldown: 10,
  hasPrefix: true,
};

// ── Command handler ──────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat } = ctx;

  try {
    const { user, media } = await fetchShotiPhotos();

    // Pass every URL straight through — no cap, no local download. The platform
    // adapter (Telegram Bot API / Discord embed) fetches each image itself.
    const attachments: NamedUrlAttachment[] = media.map((url, idx) => ({
      name: `shoti_${idx + 1}.jpg`,
      url,
    }));

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `@${user.username}`,
      attachment_url: attachments,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to fetch a Shoti photo set: \`${message}\``,
    };

    await chat.replyMessage(errPayload);
  }
};