/**
 * /safebooru — Random Safebooru Image
 *
 * Fetches a single random image from the Safebooru API (a SFW-only anime
 * image board — every post on the site is pre-filtered to "safe" rating,
 * so no additional rating check is required on our end) and sends it with
 * a persistent "🔁 Next Image" button.
 *
 * Usage:
 *   /safebooru            — random image, no tag filter
 *   /safebooru <tags...>  — random image matching the given tag(s)
 *
 * API notes:
 *   Safebooru's dapi does not expose a "give me one at random" endpoint,
 *   so we request `limit=1` against a randomly chosen page (`pid`) each
 *   time. If that page happens to be empty (tag has fewer results than the
 *   randomly picked offset) we retry a few times with a fresh page before
 *   giving up — this keeps every response to exactly one image without
 *   ever pulling down a larger batch to sample from.
 */

import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const SAFEBOORU_ENDPOINT = 'https://safebooru.org/index.php';
const MAX_PID_POOL = 50; // random page window to draw from
const MAX_ATTEMPTS = 4; // retries against empty pages before giving up
const REQUEST_TIMEOUT = 10000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface SafebooruPost {
  id: number;
  directory: string;
  image: string;
  tags: string;
  rating: string;
  width: number;
  height: number;
  score: number;
  owner: string;
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

/**
 * Requests a single random Safebooru post, optionally filtered by tags.
 * Retries a handful of random pages before returning null.
 */
async function fetchSafebooruPost(tags: string): Promise<SafebooruPost | null> {
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
        ...(tags ? { tags } : {}),
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
  name: 'safebooru',
  aliases: ['sb'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Get a single random (SFW) image from Safebooru. Optional tags to filter.',
  category: 'Anime',
  usage: '[tags]',
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
    label: '🔁 Next Image',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => onCommand(ctx),
  },
};

// ── Command Entry Point ───────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, native, event, button, session, args } = ctx;

  const isButtonAction = ctx.event['type'] === 'button_action';
  const loadingId = isButtonAction
    ? (ctx.event['messageID'] as string | undefined)
    : undefined;

  // Re-use the original tags on a button refresh (stashed in the button's
  // persisted context when the message was first sent) so "🔁 Next Image"
  // keeps filtering by the same tag(s) the user originally asked for.
  const tags = isButtonAction
    ? ((session.context as { tags?: string }).tags ?? '')
    : args.join(' ').trim().replace(/\s+/g, '_');

  // Delivers the final result: edits the existing (button-bearing) message
  // in place on a button refresh, or sends a plain reply otherwise. No
  // loading placeholder is sent — the typing indicator covers processing
  // feedback for the whole command duration.
  const deliver = async (payload: ReplyOptions): Promise<void> => {
    if (!loadingId) {
      await ctx.chat.replyMessage(payload);
      return;
    }
    try {
      await ctx.chat.editMessage({ ...payload, message_id_to_edit: loadingId });
    } catch {
      await ctx.chat.unsendMessage(loadingId).catch(() => {});
      await ctx.chat.reply(payload);
    }
  };
  const finish = deliver;
  const fail = (errorMessage: string): Promise<void> =>
    deliver({ style: MessageStyle.MARKDOWN, message: errorMessage });

  try {
    const post = await fetchSafebooruPost(tags);

    if (!post) {
      await fail(
        [
          '⚠️ **No results found.**',
          tags
            ? `No images matched tag(s): \`${tags}\`. Try different tags or none at all.`
            : 'Safebooru may be temporarily unavailable. Please try again in a moment.',
        ].join('\n'),
      );
      return;
    }

    const imageUrl = buildImageUrl(post);

    const caption = [
      '🖼️ **Random Safebooru Image**',
      tags ? ` • 🏷️ **Tags:** \`${tags}\`` : undefined,
      ` • 📐 **Size:** ${post.width}×${post.height}`,
      ` • ⭐ **Score:** ${post.score}`,
    ]
      .filter(Boolean)
      .join('\n');

    // Reuse the active instance ID when refreshing via button so the button
    // slot is updated in-place and never disappears between clicks. The
    // resolved tags are stashed into the button's context so a later
    // "🔁 Next Image" click can re-derive them from session.context.
    const resolvedButtonId = isButtonAction
      ? session.id
      : button.generateID({ id: BUTTON_ID.next, public: true });

    // Persist (or refresh the TTL on) the resolved tags so the next
    // "🔁 Next Image" click can re-derive them from session.context.
    button.createContext({ id: resolvedButtonId, context: { tags } });

    await finish({
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment_url: [{ name: `safebooru_${post.id}.${extFromFilename(post.image)}`, url: imageUrl }],
      ...(hasNativeButtons(native.platform) ? { button: [resolvedButtonId] } : {}),
    });
  } catch (err) {
    const error = err as { message?: string };
    await fail(
      `⚠️ **Error:** Something went wrong while fetching a Safebooru image: \`${error.message ?? 'Unknown error'}\``,
    );
  }
};
