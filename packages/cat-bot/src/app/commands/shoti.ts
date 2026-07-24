/**
 * /shoti — Random TikTok Video
 *
 * Fetches a random TikTok video from the Betadash "shoti" endpoint and
 * replies with the downloaded video plus a caption summarizing its
 * creator, title, and stats.
 *
 * API: registered as 'betadash' in @/engine/lib/apis.lib.js
 *       (base https://betadash-api-swordslush-production.up.railway.app)
 *
 * Response shape:
 *   {
 *     status: boolean,
 *     result: {
 *       author:      string  — TikTok display name of the creator
 *       title:       string  — video caption/title ("No title" when unset)
 *       cover_image: string  — video thumbnail URL
 *       shotiurl:    string  — direct MP4 download URL
 *       cover:       string  — creator's avatar URL
 *       username:    string  — TikTok @handle
 *       nickname:    string  — creator's display nickname
 *       duration:    number  — video length in seconds
 *       region:      string  — creator's TikTok region code
 *       total_vids:  number  — total videos served by this API instance
 *     }
 *   }
 *
 * A persistent "🔁 More Shoti" button is attached to every result (on
 * platforms that support native buttons) so the user can fetch another
 * random video in-place without re-issuing the command.
 *
 * Aliases: /ea
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

// ── API constants ──────────────────────────────────────────────────────────────

const API_URL = createUrl('betadash', '/shoti', {});

/** Maximum wait for the metadata fetch step (ms). */
const FETCH_TIMEOUT_MS = 20_000;

/** Maximum wait for the video binary download step (ms). */
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** How many times to retry a failed call before giving up. */
const MAX_RETRIES = 2;

/** Base delay between retries in ms (doubles each attempt). */
const RETRY_BASE_DELAY_MS = 2_000;

// ── API response type ────────────────────────────────────────────────────────

interface ShotiResult {
  author: string;
  title: string;
  cover_image: string;
  shotiurl: string;
  cover: string;
  username: string;
  nickname: string;
  duration: number;
  region: string;
  total_vids: number;
}

interface ShotiApiResponse {
  status: boolean;
  result?: ShotiResult;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strips characters unsafe in filenames across all major OSes. */
function safeFilename(label: string): string {
  return (
    label
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, '_')
      .trim()
      .substring(0, 80) + '.mp4'
  );
}

/** 75 → "1:15" | 8 → "0:08" */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Fetches a URL with automatic retries on network errors and 5xx responses.
 * Uses exponential backoff between attempts to avoid hammering the service.
 */
async function fetchWithRetry(
  url: string,
  timeoutMs: number,
  maxRetries = MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * attempt));
    }

    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.status >= 500 && attempt < maxRetries) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }

      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if ((err as { name?: string }).name === 'AbortError') throw err;
    }
  }

  throw lastError ?? new Error('Fetch failed after retries');
}

// ── Command configuration ────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'shoti',
  aliases: ['ea'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Sends a random TikTok video.',
  category: 'Media',
  usage: '',
  cooldown: 10,
  hasPrefix: true,
};

// ── Button definition ─────────────────────────────────────────────────────────

const BUTTON_ID = { next: 'next' } as const;

/**
 * Button definitions exported as `button`.
 * onClick re-invokes onCommand so the existing message is replaced in-place
 * with a fresh random video (mirrors the /cosplay "🔁 Next Video" button).
 */
export const button = {
  [BUTTON_ID.next]: {
    label: '🔁 More Shoti',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => onCommand(ctx),
  },
};

// ── Command handler ──────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, native, event, button, session } = ctx;

  const isButtonAction = event['type'] === 'button_action';

  try {
    // ── Step 1: Resolve video metadata ─────────────────────────────────────

    const metaRes = await fetchWithRetry(API_URL, FETCH_TIMEOUT_MS);

    if (!metaRes.ok) {
      throw new Error(
        `Shoti API returned HTTP ${metaRes.status} — the service may be temporarily unavailable.`,
      );
    }

    const data = (await metaRes.json()) as ShotiApiResponse;

    if (!data.status || !data.result?.shotiurl) {
      throw new Error('No video was returned. Try again in a moment.');
    }

    const { author, title, shotiurl, username, nickname, duration, region, total_vids } =
      data.result;

    // ── Step 2: Download video binary ────────────────────────────────────

    const videoRes = await fetchWithRetry(shotiurl, DOWNLOAD_TIMEOUT_MS);

    if (!videoRes.ok) {
      throw new Error(
        `Video download failed with HTTP ${videoRes.status}. The link may have expired — try again.`,
      );
    }

    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

    if (videoBuffer.length === 0) {
      throw new Error('The downloaded video is empty. The source may no longer be available.');
    }

    // ── Step 3: Send result ──────────────────────────────────────────────

    const displayTitle = title && title !== 'No title' ? title : '_(no title)_';

    const caption = [
      `🎥  **Shoti**`,
      '',
      `👤  **Creator**: ${nickname} (@${username})`,
      `📝  **Title**: ${displayTitle}`,
      `🌍  **Region**: ${region}`,
      `⏱️  **Duration**: ${formatDuration(duration)}`,
      `📊  **Total Vids**: ${total_vids.toLocaleString()}`,
    ].join('\n');

    // Reuse the active button instance ID when refreshing via button so the
    // button slot is updated in-place and never disappears between clicks.
    const buttonId = isButtonAction
      ? session.id
      : button.generateID({ id: BUTTON_ID.next, public: true });

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment: [
        {
          name: safeFilename(username || 'shoti'),
          stream: videoBuffer,
        },
      ],
      ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
    };

    if (isButtonAction) {
      await chat.editMessage({
        ...payload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(payload);
    }
  } catch (err) {
    const error = err as { message?: string };

    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message: [
        `❌  **Could not retrieve a Shoti video**`,
        `\`${error.message ?? 'An unexpected error occurred.'}\``,
      ].join('\n'),
    };

    if (isButtonAction) {
      await chat.editMessage({
        ...errPayload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(errPayload);
    }
  }
};
