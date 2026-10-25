/**
 * Random Photos Service — shared implementation for the random-photo family.
 *
 * Two shapes are covered:
 *
 *   1. Simple photos (/coffee, /ba) — single source, single "repeat" button.
 *   2. Tagged photos (/wallpaper) — tag/topic-driven, shared 2×3 button grid.
 */

import axios from 'axios';
import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import { createMessageDelivery } from './message-delivery.service.js';

// ════════════════════════════════════════════════════════════════════════════
// 1) SIMPLE PHOTO FAMILY — /coffee, /ba
// ════════════════════════════════════════════════════════════════════════════

type SimpleAttachment =
  | { kind: 'url'; name: string; url: string }
  | { kind: 'buffer'; name: string; buffer: Buffer };

type SimpleFetchResult =
  | { ok: true; caption: string; attachment: SimpleAttachment }
  // `notice` = a non-error reason to withhold the image (e.g. NSFW-flagged result)
  | { ok: false; notice?: string };

export interface SimplePhotoConfig {
  name: string;
  label: string;
  buttonLabel: string;
  fetch: () => Promise<SimpleFetchResult>;
}

function extFromUrl(url: string): string {
  const extMatch = url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
  return extMatch ? extMatch[1]! : 'jpg';
}

export const SIMPLE_PHOTO_BUTTON_ID = 'repeat';

/** Runs the shared simple-photo flow for a family config. */
export async function runSimplePhoto(
  ctx: AppCtx,
  config: SimplePhotoConfig,
): Promise<void> {
  const { native, button, session } = ctx;
  const isButtonAction = ctx.event['type'] === 'button_action';
  const delivery = createMessageDelivery(ctx);

  try {
    const result = await config.fetch();

    if (!result.ok) {
      // Non-error notice (e.g. NSFW-flagged) — plain message, no button.
      if (result.notice) {
        await delivery.fail(result.notice);
        return;
      }

      await delivery.fail(
        `⚠️ **Error:** Could not retrieve a ${config.label}.`,
      );
      return;
    }

    const resolvedButtonId = isButtonAction
      ? session.id
      : button.generateID({ id: SIMPLE_PHOTO_BUTTON_ID, public: true });

    const attachmentField =
      result.attachment.kind === 'url'
        ? {
            attachment_url: [
              { name: result.attachment.name, url: result.attachment.url },
            ],
          }
        : {
            attachment: [
              {
                name: result.attachment.name,
                stream: result.attachment.buffer,
              },
            ],
          };

    await delivery.deliver({
      style: MessageStyle.MARKDOWN,
      message: result.caption,
      ...attachmentField,
      ...(hasNativeButtons(native.platform)
        ? { button: [resolvedButtonId] }
        : {}),
    });
  } catch (err) {
    const error = err as { message?: string };
    await delivery.fail(
      `⚠️ **System Error:** Failed to fetch a ${config.label}: \`${error.message ?? 'Unknown error'}\``,
    );
  }
}

export interface SimplePhotoButtonDefinition {
  label: string;
  style: (typeof ButtonStyle)[keyof typeof ButtonStyle];
  onClick: (ctx: AppCtx) => Promise<void>;
}

/** Builds the repeat button for a simple-photo config. */
export function createSimplePhotoButton(
  config: SimplePhotoConfig,
): Record<string, SimplePhotoButtonDefinition> {
  return {
    [SIMPLE_PHOTO_BUTTON_ID]: {
      label: config.buttonLabel,
      style: ButtonStyle.PRIMARY,
      onClick: async (ctx: AppCtx): Promise<void> =>
        runSimplePhoto(ctx, config),
    },
  };
}

export const coffeePhotoConfig: SimplePhotoConfig = {
  name: 'coffee',
  label: 'coffee image',
  buttonLabel: '🔁 Another Cup',
  fetch: async () => {
    const { data } = await axios.get<{ file?: string }>(
      'https://coffee.alexflipnote.dev/random.json',
      { headers: { Accept: 'application/json' }, timeout: 10000 },
    );
    const imageUrl = data?.file;
    if (!imageUrl) return { ok: false };
    return {
      ok: true,
      caption: '☕ **Random Coffee Image**',
      attachment: {
        kind: 'url',
        name: `coffee.${extFromUrl(imageUrl)}`,
        url: imageUrl,
      },
    };
  },
};

export const blueArchivePhotoConfig: SimplePhotoConfig = {
  name: 'ba',
  label: 'Blue Archive image',
  buttonLabel: '🔄 Refresh',
  fetch: async () => {
    const { data } = await axios.get<string[]>(
      'https://raw.githubusercontent.com/rynxzyy/blue-archive-r-img/refs/heads/main/links.json',
    );
    const imageUrl = data[Math.floor(data.length * Math.random())];
    if (!imageUrl) return { ok: false };
    // Directly pass the source URL through — no local download.
    return {
      ok: true,
      caption: '🎓 **Random Blue Archive Image**',
      attachment: { kind: 'url', name: 'bluearchive.jpg', url: imageUrl },
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 2) TAGGED PHOTO FAMILY — /wallpaper
// ════════════════════════════════════════════════════════════════════════════

const TAG_BUTTON_ID = {
  random: 'random',
  nature: 'nature',
  space: 'space',
  city: 'city',
  sunset: 'sunset',
  anime: 'anime',
} as const;

const TAG_PRESETS = {
  [TAG_BUTTON_ID.random]: { label: '🎲 Random', tag: '' },
  [TAG_BUTTON_ID.nature]: { label: '🌿 Nature', tag: 'nature' },
  [TAG_BUTTON_ID.space]: { label: '🌌 Space', tag: 'space' },
  [TAG_BUTTON_ID.city]: { label: '🏙️ City', tag: 'city' },
  [TAG_BUTTON_ID.sunset]: { label: '🌅 Sunset', tag: 'sunset' },
  [TAG_BUTTON_ID.anime]: { label: '✨ Anime', tag: 'anime' },
} as const;

export const WALLPAPER_DEFAULT_WIDTH = 1920;
export const WALLPAPER_DEFAULT_HEIGHT = 1080;

function buildTagButtonGrid(btn: AppCtx['button']): string[][] {
  return [
    [
      btn.generateID({ id: TAG_BUTTON_ID.random, public: true }),
      btn.generateID({ id: TAG_BUTTON_ID.nature, public: true }),
      btn.generateID({ id: TAG_BUTTON_ID.space, public: true }),
    ],
    [
      btn.generateID({ id: TAG_BUTTON_ID.city, public: true }),
      btn.generateID({ id: TAG_BUTTON_ID.sunset, public: true }),
      btn.generateID({ id: TAG_BUTTON_ID.anime, public: true }),
    ],
  ];
}

export function parseWallpaperArgs(args: string[]): {
  query: string;
  width: number;
  height: number;
} {
  let width = WALLPAPER_DEFAULT_WIDTH;
  let height = WALLPAPER_DEFAULT_HEIGHT;
  const parts = [...args];

  const lastArg = parts[parts.length - 1] ?? '';
  const match = /^(\d{3,4})x(\d{3,4})$/i.exec(lastArg);

  if (match) {
    width = Math.min(3840, parseInt(match[1]!, 10));
    height = Math.min(2160, parseInt(match[2]!, 10));
    parts.pop();
  }

  const query = parts.join(' ').trim();
  return { query, width, height };
}

export async function renderWallpaper(
  ctx: AppCtx,
  query: string,
  width: number,
  height: number,
): Promise<void> {
  const { chat, event, native, button: btn } = ctx;
  const isButtonAction = event['type'] === 'button_action';
  const buttonGrid = hasNativeButtons(native.platform)
    ? buildTagButtonGrid(btn)
    : [];

  try {
    let url: string;
    let sourceName: string;

    if (query) {
      url = `https://loremflickr.com/${width}/${height}/${encodeURIComponent(query)}/all`;
      sourceName = 'LoremFlickr';
    } else {
      url = `https://picsum.photos/${width}/${height}`;
      sourceName = 'Picsum';
    }

    const caption =
      `🖼️ **Wallpaper Generated**\n` +
      `📐 **Size:** ${width}×${height}\n` +
      `🔎 **Topic:** ${query || 'Random'}\n` +
      `📷 **Source:** ${sourceName}`;

    const wallpaperPayload: ReplyOptions = {
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment_url: [{ name: `wallpaper_${width}x${height}.jpg`, url }],
      ...(buttonGrid.length > 0 ? { button: buttonGrid } : {}),
    };

    if (isButtonAction) {
      await chat.editMessage({
        ...wallpaperPayload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(wallpaperPayload);
    }
  } catch (err) {
    const error = err as { message?: string; response?: { status?: number } };
    let errorMsg = `⚠️ **Generation Failed**\n\`${error.message ?? 'Unknown error'}\``;
    if (error.response?.status === 404) {
      errorMsg = `⚠️ **Not Found**\nCould not find a wallpaper for "_${query}_". Try a simpler term.`;
    }

    const errorPayload: ReplyOptions = {
      style: MessageStyle.MARKDOWN,
      message: errorMsg,
      ...(buttonGrid.length > 0 ? { button: buttonGrid } : {}),
    };

    if (isButtonAction) {
      await chat.editMessage({
        ...errorPayload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(errorPayload);
    }
  }
}

export interface WallpaperButtonDefinition {
  label: string;
  style: (typeof ButtonStyle)[keyof typeof ButtonStyle];
  onClick: (ctx: AppCtx) => Promise<void>;
}

function buildTagButtons(
  render: (ctx: AppCtx, tag: string) => Promise<void>,
): Record<string, WallpaperButtonDefinition> {
  return {
    [TAG_BUTTON_ID.random]: {
      label: TAG_PRESETS[TAG_BUTTON_ID.random].label,
      style: ButtonStyle.PRIMARY,
      onClick: async (ctx: AppCtx): Promise<void> =>
        render(ctx, TAG_PRESETS[TAG_BUTTON_ID.random].tag),
    },
    [TAG_BUTTON_ID.nature]: {
      label: TAG_PRESETS[TAG_BUTTON_ID.nature].label,
      style: ButtonStyle.SECONDARY,
      onClick: async (ctx: AppCtx): Promise<void> =>
        render(ctx, TAG_PRESETS[TAG_BUTTON_ID.nature].tag),
    },
    [TAG_BUTTON_ID.space]: {
      label: TAG_PRESETS[TAG_BUTTON_ID.space].label,
      style: ButtonStyle.SUCCESS,
      onClick: async (ctx: AppCtx): Promise<void> =>
        render(ctx, TAG_PRESETS[TAG_BUTTON_ID.space].tag),
    },
    [TAG_BUTTON_ID.city]: {
      label: TAG_PRESETS[TAG_BUTTON_ID.city].label,
      style: ButtonStyle.DANGER,
      onClick: async (ctx: AppCtx): Promise<void> =>
        render(ctx, TAG_PRESETS[TAG_BUTTON_ID.city].tag),
    },
    [TAG_BUTTON_ID.sunset]: {
      label: TAG_PRESETS[TAG_BUTTON_ID.sunset].label,
      style: ButtonStyle.PRIMARY,
      onClick: async (ctx: AppCtx): Promise<void> =>
        render(ctx, TAG_PRESETS[TAG_BUTTON_ID.sunset].tag),
    },
    [TAG_BUTTON_ID.anime]: {
      label: TAG_PRESETS[TAG_BUTTON_ID.anime].label,
      style: ButtonStyle.SECONDARY,
      onClick: async (ctx: AppCtx): Promise<void> =>
        render(ctx, TAG_PRESETS[TAG_BUTTON_ID.anime].tag),
    },
  };
}

// Note: /wallpaper's buttons intentionally always regenerate at the default
// 1920×1080 size — a custom WxH passed to the initial call only applies to
// that first image.
const wallpaperButtonRender = (ctx: AppCtx, tag: string): Promise<void> =>
  renderWallpaper(ctx, tag, WALLPAPER_DEFAULT_WIDTH, WALLPAPER_DEFAULT_HEIGHT);

/** Builds the shared 2×3 wallpaper tag button grid. */
export function createWallpaperButtons(): Record<
  string,
  WallpaperButtonDefinition
> {
  return buildTagButtons(wallpaperButtonRender);
}
