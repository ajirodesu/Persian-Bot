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
 * Deliberately does NOT use withLoadingMedia()'s edit-in-place swap:
 * Telegram's editMessageMedia can only ever replace a message with a
 * SINGLE media item (a real Bot API constraint, not a bug here) — so
 * editing the loading message into the result would silently truncate a
 * 7-photo set down to 1, no error thrown. Instead the loading message is
 * dismissed and the full set is sent as a fresh reply via
 * chat.replyMessage(), whose Telegram adapter batches multiple photo
 * attachment_url entries into one sendMediaGroup album call (see
 * replyMessage.ts). `media` is capped at MAX_IMAGES (10) — Telegram's own
 * sendMediaGroup / Discord's per-message attachment ceiling — before
 * sending, so a larger response never gets rejected by the platform.
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

/** Maximum wait for the fetch (ms). */
const FETCH_TIMEOUT_MS = 20_000;

/** The set sent to the user must always have at least this many photos. */
const MIN_IMAGES = 2;

/** Telegram's sendMediaGroup album cap — also Discord's per-message
 *  attachment cap — the hard ceiling on how many photos a single send can
 *  ever contain, regardless of platform. */
const MAX_IMAGES = 10;

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

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat } = ctx;

  const loadingId = (await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '🎲 **Fetching a random Shoti photo set...**',
  })) as string | undefined;

  try {
    const { user, media } = await fetchShotiPhotos();

    if (media.length < MIN_IMAGES) {
      throw new Error('The API returned a single-photo set. Try again in a moment.');
    }

    const attachments: NamedUrlAttachment[] = media.slice(0, MAX_IMAGES).map((url, idx) => ({
      name: `shoti_${idx + 1}.jpg`,
      url,
    }));

    // Dismiss the loading message and send the set fresh — editing it in
    // place would cap the result at 1 photo (see file header).
    if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});

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

    if (loadingId) {
      await chat.editMessage({ ...errPayload, message_id_to_edit: loadingId }).catch(async () => {
        await chat.unsendMessage(loadingId).catch(() => {});
        await chat.replyMessage(errPayload);
      });
    } else {
      await chat.replyMessage(errPayload);
    }
  }
};