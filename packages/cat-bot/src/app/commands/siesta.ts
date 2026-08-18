/**
 * /siesta — Random Siesta Photo
 *
 * Fetches a single random image of Siesta (from The Detective Is Already
 * Dead) from the Safebooru API (a SFW-only anime image board — every post on
 * the site is pre-filtered to "safe" rating, so no additional rating check
 * is required on our end) and sends it with a persistent "🔁 Next Siesta"
 * button.
 *
 * Unlike /safebooru there is no tag argument: the character tag is fixed
 * (`siesta_(tantei_wa_mou_shindeiru)` — Siesta from The Detective Is Already
 * Dead), so every result is a photo of Siesta and the button simply fetches
 * another one.
 *
 * API notes:
 *   Safebooru's dapi does not expose a "give me one at random" endpoint,
 *   so we request `limit=1` against a randomly chosen page (`pid`) each
 *   time. If that page happens to be empty (random offset past the end of
 *   the tag's results) we retry a few times with a fresh page before giving
 *   up — this keeps every response to exactly one image without ever pulling
 *   down a larger batch to sample from.
 */

import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const SAFEBOORU_ENDPOINT = 'https://safebooru.org/index.php';
/** Fixed character tag — Siesta from The Detective Is Already Dead. */
const SIESTA_TAG = 'siesta_(tantei_wa_mou_shindeiru)';
// Wider random page window than /safebooru's 50: the tag is fixed with a
// known pool of ~141 posts, so drawing from 0–149 samples nearly every post
// instead of only the first 50. Empty pages are retried below.
const MAX_PID_POOL = 150;
const MAX_ATTEMPTS = 4; // retries against empty pages before giving up
const REQUEST_TIMEOUT = 10000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface SafebooruPost {
  id: number;
  directory: string;
  image: string;
  width: number;
  height: number;
  score: number;
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

/**
 * Requests a single random Safebooru post tagged with the fixed Siesta tag.
 * Retries a handful of random pages before returning null.
 */
async function fetchSiestaPost(): Promise<SafebooruPost | null> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const pid = Math.floor(Math.random() * MAX_PID_POOL);

    const { data } = await axios.get<SafebooruPost[]>(SAFEBOORU_ENDPOINT, {
      timeout: REQUEST_TIMEOUT,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cat-Bot/1.0)' },
      params: {
        page: 'dapi',
        s: 'post',
        q: 'index',
        json: 1,
        limit: 1,
        pid,
        tags: SIESTA_TAG,
      },
    });

    if (Array.isArray(data) && data.length > 0 && data[0]) {
      return data[0];
    }
  }

  return null;
}

function buildImageUrl(post: SafebooruPost): string {
  return `https://safebooru.org/images/${post.directory}/${post.image}`;
}

function extFromFilename(filename: string): string {
  const extMatch = filename.match(/\.(jpg|jpeg|png|gif|webp)$/i);
  return extMatch ? extMatch[1]! : 'jpg';
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'siesta',
  aliases: ['siestapic'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Send a random photo of Siesta.',
  category: 'Anime',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Button Definition ─────────────────────────────────────────────────────────

const BUTTON_ID = { next: 'next' } as const;

/**
 * Button definitions exported as `button`.
 * onClick re-invokes onCommand so the existing message is replaced in-place.
 */
export const button = {
  [BUTTON_ID.next]: {
    label: '🔁 Next Siesta',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => onCommand(ctx),
  },
};

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { native, button, session } = ctx;

  const isButtonAction = ctx.event['type'] === 'button_action';
  const loadingId = isButtonAction
    ? (ctx.event['messageID'] as string | undefined)
    : undefined;

  // Delivers the final result: edits the existing (button-bearing) message
  // in place on a button refresh, or sends a plain reply otherwise. No
  // loading placeholder is sent — the typing indicator covers processing
  // feedback for the whole command duration.
  const deliver = async (payload: ReplyOptions): Promise<void> => {
    if (!loadingId) {
      await ctx.chat.replyMessage(payload);
      return;
    }
    // Always edit the original message in place — never delete it and send a
    // new one. A delete+resend fallback here would mean a failed refresh
    // silently replaces the message the user was looking at with a brand-new
    // one (breaks reply threads, moves it to the bottom of the chat, etc.).
    // If the edit itself fails, let the error propagate to the caller.
    await ctx.chat.editMessage({ ...payload, message_id_to_edit: loadingId });
  };
  const finish = deliver;
  const fail = (errorMessage: string): Promise<void> =>
    deliver({ style: MessageStyle.MARKDOWN, message: errorMessage });

  try {
    const post = await fetchSiestaPost();

    if (!post) {
      await fail(
        '⚠️ **No results found.** No Siesta images could be retrieved. Please try again in a moment.',
      );
      return;
    }

    const imageUrl = buildImageUrl(post);

    const caption = [
      '🖼️ **Random Siesta Photo**',
      ` • 📐 **Size:** ${post.width}×${post.height}`,
      ` • ⭐ **Score:** ${post.score}`,
    ].join('\n');

    // Reuse the active instance ID when refreshing via button so the button
    // slot is updated in-place and never disappears between clicks.
    const resolvedButtonId = isButtonAction
      ? session.id
      : button.generateID({ id: BUTTON_ID.next, public: true });

    await finish({
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment_url: [
        {
          name: `siesta_${post.id}.${extFromFilename(post.image)}`,
          url: imageUrl,
        },
      ],
      ...(hasNativeButtons(native.platform)
        ? { button: [resolvedButtonId] }
        : {}),
    });
  } catch (err) {
    const error = err as { message?: string };
    await fail(
      `⚠️ **Error:** Something went wrong while fetching a Siesta photo: \`${error.message ?? 'Unknown error'}\``,
    );
  }
};
