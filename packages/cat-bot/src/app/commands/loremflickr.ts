/**
 * /loremflickr — Tagged Random Image
 * Fetches a random photo for a chosen tag via the Delirius LoremFlickr proxy.
 *
 * Button layout — 2 × 3 grid (mirrors /wallpaper):
 *   Row 1: [🎲 Random] [🌿 Nature] [🌌 Space]
 *   Row 2: [🏙️ City]  [🌅 Sunset] [✨ Anime]
 *
 * Discord compatibility notes:
 *   - Discord hard-caps ActionRows at 5 buttons each. Passing all 6 IDs in a flat
 *     string[] collapses them into a single row of 6 and Discord rejects the message.
 *     The fix is a string[][] where each inner array is its own ActionRow (row = max 5).
 *   - context.model.normalizeRows() detects the 2-D structure automatically —
 *     the 2-D array passes straight through to resolveButtons() without further wrapping.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';

// ── Fixed tag pool (used for the "Random" preset) ────────────────────────────

const RANDOM_POOL = ['nature', 'space', 'city', 'sunset', 'anime'] as const;

function pickRandomTag(): string {
  return RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)]!;
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchLoremFlickr(tag: string): Promise<Buffer> {
  const url = createUrl('delirius', '/random/loremflickr', { flags: tag });
  const response = await fetch(url);

  if (!response.ok)
    throw new Error(`LoremFlickr API responded with status ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer.byteLength) throw new Error('Empty image returned');

  return Buffer.from(arrayBuffer);
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'loremflickr',
  aliases: ['flickr'] as string[],
  version: '1.2.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Get a random photo from a fixed set of tags.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Button IDs ────────────────────────────────────────────────────────────────

const BUTTON_ID = {
  random: 'random',
  nature: 'nature',
  space: 'space',
  city: 'city',
  sunset: 'sunset',
  anime: 'anime',
} as const;

// ── Presets ───────────────────────────────────────────────────────────────────

const PRESETS = {
  [BUTTON_ID.random]: { label: '🎲 Random', tag: '' },
  [BUTTON_ID.nature]: { label: '🌿 Nature', tag: 'nature' },
  [BUTTON_ID.space]: { label: '🌌 Space', tag: 'space' },
  [BUTTON_ID.city]: { label: '🏙️ City', tag: 'city' },
  [BUTTON_ID.sunset]: { label: '🌅 Sunset', tag: 'sunset' },
  [BUTTON_ID.anime]: { label: '✨ Anime', tag: 'anime' },
} as const;

// ── Grid builder ──────────────────────────────────────────────────────────────
//
// Builds the 2 × 3 button grid as a string[][].
//
//   Row 1: [🎲 Random] [🌿 Nature] [🌌 Space]
//   Row 2: [🏙️ City]  [🌅 Sunset] [✨ Anime]
//
// Each inner array maps to one Discord ActionRow (max 5 buttons each).
// context.model.normalizeRows() detects the 2-D structure and passes it through
// unchanged — no extra wrapping needed on the caller's side.

function buildButtonGrid(btn: AppCtx['button']): string[][] {
  return [
    // ── Row 1 ────────────────────────────────────────────────────────────────
    [
      btn.generateID({ id: BUTTON_ID.random, public: true }),
      btn.generateID({ id: BUTTON_ID.nature, public: true }),
      btn.generateID({ id: BUTTON_ID.space, public: true }),
    ],
    // ── Row 2 ────────────────────────────────────────────────────────────────
    [
      btn.generateID({ id: BUTTON_ID.city, public: true }),
      btn.generateID({ id: BUTTON_ID.sunset, public: true }),
      btn.generateID({ id: BUTTON_ID.anime, public: true }),
    ],
  ];
}

// ── Core render logic ─────────────────────────────────────────────────────────
//
// Shared render logic used by both onCommand (fresh send) and button onClick (in-place edit).
//
// Flow:
//   isButtonAction = false  →  send loading message → fetch image → unsend loading → send photo
//   isButtonAction = true   →  fetch image → editMessage with new photo (no loading flash)

async function renderLoremFlickr(ctx: AppCtx, tag: string): Promise<void> {
  const { chat, event, native, button: btn } = ctx;
  const isButtonAction = event['type'] === 'button_action';

  // Build grid once — reused in both the success and error payloads.
  const buttonGrid = hasNativeButtons(native.platform)
    ? buildButtonGrid(btn)
    : [];

  // ── Loading indicator (fresh command only) ────────────────────────────────
  let loadingId: string | undefined;

  if (!isButtonAction) {
    loadingId = (await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **Finding photo...**\n🏷️ Tag: _${tag || 'Random'}_`,
    })) as string | undefined;
  }

  try {
    // ── Resolve tag & fetch image ──────────────────────────────────────────
    const resolvedTag = tag || pickRandomTag();
    const image = await fetchLoremFlickr(resolvedTag);

    const caption = `🖼️ **LoremFlickr**\n🏷️ **Tag:** ${resolvedTag}`;

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment: [{ name: `loremflickr_${resolvedTag}.jpg`, stream: image }],
      ...(buttonGrid.length > 0 ? { button: buttonGrid } : {}),
    };

    if (isButtonAction) {
      // Edit the existing message in-place — no new message noise.
      await chat.editMessage({
        ...payload,
        message_id_to_edit: event['messageID'] as string,
      });
      return;
    }

    // Remove the loading message before posting the photo.
    if (loadingId) {
      await chat.unsendMessage(loadingId).catch(() => {});
    }

    await chat.replyMessage(payload);
  } catch (err) {
    // ── Error handling ──────────────────────────────────────────────────────
    const error = err as { message?: string };
    const errorMsg = `⚠️ **Fetch Failed**\n\`${error.message ?? 'Unknown error'}\``;

    const errorPayload = {
      style: MessageStyle.MARKDOWN,
      message: errorMsg,
      // Keep the grid visible even on errors so users can try a different tag.
      ...(buttonGrid.length > 0 ? { button: buttonGrid } : {}),
    };

    if (isButtonAction) {
      await chat.editMessage({
        ...errorPayload,
        message_id_to_edit: event['messageID'] as string,
      });
      return;
    }

    // Replace the loading message with the error so it doesn't linger.
    if (loadingId) {
      await chat.editMessage({
        ...errorPayload,
        message_id_to_edit: loadingId,
      });
    } else {
      await chat.replyMessage(errorPayload);
    }
  }
}

// ── Button definitions ────────────────────────────────────────────────────────

export const button = {
  [BUTTON_ID.random]: {
    label: PRESETS[BUTTON_ID.random].label,
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) =>
      renderLoremFlickr(ctx, PRESETS[BUTTON_ID.random].tag),
  },

  [BUTTON_ID.nature]: {
    label: PRESETS[BUTTON_ID.nature].label,
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx) =>
      renderLoremFlickr(ctx, PRESETS[BUTTON_ID.nature].tag),
  },

  [BUTTON_ID.space]: {
    label: PRESETS[BUTTON_ID.space].label,
    style: ButtonStyle.SUCCESS,
    onClick: async (ctx: AppCtx) =>
      renderLoremFlickr(ctx, PRESETS[BUTTON_ID.space].tag),
  },

  [BUTTON_ID.city]: {
    label: PRESETS[BUTTON_ID.city].label,
    style: ButtonStyle.DANGER,
    onClick: async (ctx: AppCtx) =>
      renderLoremFlickr(ctx, PRESETS[BUTTON_ID.city].tag),
  },

  [BUTTON_ID.sunset]: {
    label: PRESETS[BUTTON_ID.sunset].label,
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) =>
      renderLoremFlickr(ctx, PRESETS[BUTTON_ID.sunset].tag),
  },

  [BUTTON_ID.anime]: {
    label: PRESETS[BUTTON_ID.anime].label,
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx) =>
      renderLoremFlickr(ctx, PRESETS[BUTTON_ID.anime].tag),
  },
};

// ── Entry point ───────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { args } = ctx;
  const tag = args.join(' ').trim();
  await renderLoremFlickr(ctx, tag);
};